// Tool system - mirrors KiCad's TOOL_MANAGER + SCH_DRAWING_TOOLS + SCH_LINE_WIRE_BUS_TOOL

import type { Vec2 } from "./types";
import { LineMode, vec2, vec2Sub } from "./types";
import { SchLine, SchJunction, SchLabel, SchSymbol, SchNoConnect, type SchItem } from "./items";
import { SchematicDoc } from "./schematic-doc";
import { GridHelper, SnapMode } from "./grid";
import { ChangeType } from "./undo";

// ==================== Tool Events ====================

export type ToolEventType =
  | "click"
  | "dblclick"
  | "mousedown"
  | "mouseup"
  | "motion"
  | "keydown"
  | "keyup";

export interface ToolEvent {
  type: ToolEventType;
  pos: Vec2;        // World coordinates (snapped)
  rawPos: Vec2;     // World coordinates (unsnapped)
  key?: string;
  shift?: boolean;
  ctrl?: boolean;
  button?: number;
}

// ==================== Active Tool State ====================

export enum ToolType {
  SELECT = "select",
  WIRE = "wire",
  BUS = "bus",
  LABEL = "label",
  GLOBAL_LABEL = "global_label",
  SYMBOL = "symbol",
  JUNCTION = "junction",
  NO_CONNECT = "no_connect",
  MOVE = "move",
}

// ==================== Tool Manager ====================

export type EditorCallback = {
  requestRedraw: () => void;
  requestSymbolChooser: () => Promise<string | null>; // Returns libId or null
  requestLabelText: (current?: string) => Promise<string | null>;
  showStatus: (msg: string) => void;
  setCursor: (cursor: string) => void;
};

export class ToolManager {
  doc: SchematicDoc;
  grid = new GridHelper();
  activeTool: ToolType = ToolType.SELECT;
  lineMode: LineMode = LineMode.ORTHO_90;
  callbacks: EditorCallback;

  // Wire drawing state
  private wireSegments: SchLine[] = [];
  private wirePosture = false;

  // Move/drag state
  private moveItems: SchItem[] = [];
  private moveOrigin: Vec2 = vec2(0, 0);
  private isDragging = false;
  private dragStartPos: Vec2 = vec2(0, 0);
  private mouseDown = false;
  private dragThreshold = 0.5; // world units before drag starts

  // Selection
  selection: Set<string> = new Set();

  constructor(doc: SchematicDoc, callbacks: EditorCallback) {
    this.doc = doc;
    this.callbacks = callbacks;
  }

  // ==================== Tool Switching ====================

  setTool(tool: ToolType): void {
    this.cancelCurrentTool();
    this.activeTool = tool;
    this.callbacks.setCursor(tool === ToolType.SELECT ? "default" : "crosshair");
    this.callbacks.showStatus(`Tool: ${tool}`);
  }

  cancelCurrentTool(): void {
    if (this.wireSegments.length > 0) {
      // Remove preview wires
      for (const seg of this.wireSegments) {
        this.doc.removeItem(seg);
      }
      this.wireSegments = [];
    }
    if (this.moveItems.length > 0) {
      this.moveItems = [];
    }
    this.doc.undo.revert();
    this.callbacks.requestRedraw();
  }

  // ==================== Event Dispatch ====================

  handleEvent(evt: ToolEvent): void {
    switch (this.activeTool) {
      case ToolType.SELECT:
        this.handleSelect(evt);
        break;
      case ToolType.WIRE:
      case ToolType.BUS:
        this.handleDrawWire(evt);
        break;
      case ToolType.LABEL:
      case ToolType.GLOBAL_LABEL:
        this.handlePlaceLabel(evt);
        break;
      case ToolType.SYMBOL:
        this.handlePlaceSymbol(evt);
        break;
      case ToolType.JUNCTION:
        this.handlePlaceJunction(evt);
        break;
      case ToolType.NO_CONNECT:
        this.handlePlaceNoConnect(evt);
        break;
      case ToolType.MOVE:
        this.handleMove(evt);
        break;
    }

    // Global key shortcuts
    if (evt.type === "keydown") {
      this.handleGlobalKeys(evt);
    }
  }

  // ==================== Selection Tool ====================

  private handleSelect(evt: ToolEvent): void {
    if (evt.type === "mousedown") {
      this.mouseDown = true;
      this.isDragging = false;
      this.dragStartPos = { ...evt.pos };

      const hits = this.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);

      if (topHit) {
        if (evt.shift) {
          // Toggle selection
          if (this.selection.has(topHit.id)) {
            this.selection.delete(topHit.id);
          } else {
            this.selection.add(topHit.id);
          }
        } else if (!this.selection.has(topHit.id)) {
          // Select the clicked item (clear others unless already selected)
          this.selection.clear();
          this.selection.add(topHit.id);
        }
        // If already selected, keep selection (may start drag)
      } else if (!evt.shift) {
        this.selection.clear();
      }
      this.callbacks.requestRedraw();
    }

    if (evt.type === "motion" && this.mouseDown) {
      const dx = evt.pos.x - this.dragStartPos.x;
      const dy = evt.pos.y - this.dragStartPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.isDragging && dist > this.dragThreshold && this.selection.size > 0) {
        // Start drag-move
        this.isDragging = true;
        this.moveItems = [];
        for (const id of this.selection) {
          const item = this.doc.getItem(id);
          if (item) {
            this.doc.commitModify(item);
            this.moveItems.push(item);
          }
        }
        this.moveOrigin = { ...this.dragStartPos };
        this.callbacks.setCursor("grabbing");
        this.callbacks.showStatus("Dragging...");
      }

      if (this.isDragging && this.moveItems.length > 0) {
        const delta = vec2Sub(evt.pos, this.moveOrigin);
        for (const item of this.moveItems) {
          item.move(delta);
        }
        this.moveOrigin = { ...evt.pos };
        this.callbacks.requestRedraw();
      }
    }

    if (evt.type === "mouseup") {
      if (this.isDragging && this.moveItems.length > 0) {
        // Finish drag-move
        this.doc.commitPush("Move items");
        this.moveItems = [];
        this.isDragging = false;
        this.callbacks.setCursor("default");
        this.callbacks.showStatus("Moved");
      }
      this.mouseDown = false;
      this.isDragging = false;
      this.callbacks.requestRedraw();
    }

    if (evt.type === "click") {
      // click is now only used for non-drag clicks handled via mousedown/mouseup
    }

    if (evt.type === "dblclick") {
      const hits = this.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);
      if (topHit) {
        this.callbacks.showStatus(`Properties: ${topHit.itemType} ${topHit.id}`);
      }
    }
  }

  private pickBest(hits: SchItem[]): SchItem | null {
    if (hits.length === 0) return null;
    // Priority: junction > label > wire > symbol > sheet
    const priority: Record<string, number> = {
      junction: 0, no_connect: 0, label: 1, global_label: 1,
      hier_label: 1, wire: 2, bus: 3, symbol: 4, sheet: 5,
    };
    hits.sort((a, b) => (priority[a.itemType] ?? 9) - (priority[b.itemType] ?? 9));
    return hits[0] ?? null;
  }

  // ==================== Wire Drawing Tool ====================
  // Mirrors KiCad's SCH_LINE_WIRE_BUS_TOOL::doDrawSegments

  private handleDrawWire(evt: ToolEvent): void {
    const layer = this.activeTool === ToolType.BUS ? "bus" : "wire";

    if (evt.type === "mousedown" || evt.type === "click") {
      if (this.wireSegments.length === 0) {
        // Start new wire
        this.startWire(evt.pos, layer);
      } else {
        // Place current point and continue
        this.advanceWire(evt.pos);
      }
    }

    if (evt.type === "motion" && this.wireSegments.length > 0) {
      this.updateWirePreview(evt.pos);
    }

    if (evt.type === "dblclick" && this.wireSegments.length > 0) {
      this.finishWire();
    }

    if (evt.type === "keydown") {
      if (evt.key === " ") {
        this.wirePosture = !this.wirePosture;
        this.updateWirePreview(evt.pos);
      } else if (evt.key === "Backspace" && this.wireSegments.length > 1) {
        this.undoLastWireSegment();
      } else if (evt.key === "/") {
        // Cycle line mode
        this.lineMode = (this.lineMode + 1) % 3;
        this.updateWirePreview(evt.pos);
        this.callbacks.showStatus(
          `Line mode: ${["Free", "90°", "45°"][this.lineMode]}`,
        );
      }
    }
  }

  private startWire(pos: Vec2, layer: "wire" | "bus"): void {
    const seg1 = new SchLine(pos, pos, layer);
    const seg2 = new SchLine(pos, pos, layer);
    this.doc.addItem(seg1);
    this.doc.addItem(seg2);
    this.wireSegments = [seg1, seg2];
    this.wirePosture = false;
    this.callbacks.showStatus("Drawing wire... Click to place, Dbl-click/Esc to finish");
  }

  private updateWirePreview(cursor: Vec2): void {
    if (this.wireSegments.length < 2) return;

    const seg1 = this.wireSegments[this.wireSegments.length - 2]!;
    const seg2 = this.wireSegments[this.wireSegments.length - 1]!;
    const start = seg1.start;

    const breakPt = this.computeBreakPoint(start, cursor);

    seg1.end = breakPt;
    seg2.start = breakPt;
    seg2.end = cursor;

    this.callbacks.requestRedraw();
  }

  private computeBreakPoint(start: Vec2, cursor: Vec2): Vec2 {
    const dx = cursor.x - start.x;
    const dy = cursor.y - start.y;

    if (this.lineMode === LineMode.FREE) {
      return { ...cursor };
    }

    if (this.lineMode === LineMode.ORTHO_90) {
      if (this.wirePosture) {
        // Vertical first, then horizontal
        return { x: start.x, y: cursor.y };
      } else {
        // Horizontal first, then vertical
        return { x: cursor.x, y: start.y };
      }
    }

    // 45-degree mode
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minD = Math.min(absDx, absDy);
    const xDir = dx >= 0 ? 1 : -1;
    const yDir = dy >= 0 ? 1 : -1;

    if (this.wirePosture) {
      // Diagonal first, then straight
      return { x: start.x + xDir * minD, y: start.y + yDir * minD };
    } else {
      // Straight first, then diagonal
      if (absDx > absDy) {
        return { x: cursor.x - xDir * minD, y: start.y };
      } else {
        return { x: start.x, y: cursor.y - yDir * minD };
      }
    }
  }

  private advanceWire(pos: Vec2): void {
    if (this.wireSegments.length < 2) return;

    const lastSeg = this.wireSegments[this.wireSegments.length - 1]!;
    const prevSeg = this.wireSegments[this.wireSegments.length - 2]!;

    // Remove zero-length segments
    if (prevSeg.isNull()) {
      this.doc.removeItem(prevSeg);
      this.wireSegments.splice(this.wireSegments.length - 2, 1);
    }

    // Check if we hit a connectable item — auto-finish
    const connected = this.doc.findConnectableAt(pos, lastSeg);
    if (connected.length > 0 && this.wireSegments.length > 1) {
      lastSeg.end = pos;
      if (!lastSeg.isNull()) {
        this.finishWire();
        return;
      }
    }

    // Continue: create next pair of segments
    const layer = lastSeg.layer;
    const newSeg1 = new SchLine(pos, pos, layer);
    const newSeg2 = new SchLine(pos, pos, layer);
    this.doc.addItem(newSeg1);
    this.doc.addItem(newSeg2);
    this.wireSegments.push(newSeg1, newSeg2);
    this.wirePosture = false;
  }

  private undoLastWireSegment(): void {
    if (this.wireSegments.length <= 2) return;

    // Remove last two segments
    const removed1 = this.wireSegments.pop()!;
    const removed2 = this.wireSegments.pop()!;
    this.doc.removeItem(removed1);
    this.doc.removeItem(removed2);

    this.callbacks.requestRedraw();
  }

  private finishWire(): void {
    // Clean up: remove null segments, merge collinear
    const toKeep: SchLine[] = [];

    for (const seg of this.wireSegments) {
      if (!seg.isNull()) {
        toKeep.push(seg);
      } else {
        this.doc.removeItem(seg);
      }
    }

    // Add junctions where wires intersect existing connections
    for (const seg of toKeep) {
      for (const cp of seg.getConnectionPoints()) {
        if (this.doc.needsJunction(cp) && !this.doc.hasJunctionAt(cp)) {
          const junction = new SchJunction(cp);
          this.doc.addItem(junction);
          this.doc.undo.stage(junction, ChangeType.ADD);
        }
      }
    }

    // Stage all kept segments in undo
    for (const seg of toKeep) {
      this.doc.undo.stage(seg, ChangeType.ADD);
    }

    this.doc.undo.push("Draw wire", () => {});
    this.wireSegments = [];
    this.callbacks.requestRedraw();
    this.callbacks.showStatus("Wire placed");
  }

  // ==================== Label Placement ====================

  private async handlePlaceLabel(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const labelType = this.activeTool === ToolType.GLOBAL_LABEL
      ? "global_label"
      : "label";

    const text = await this.callbacks.requestLabelText();
    if (!text) return;

    const label = new SchLabel(evt.pos, text, labelType as any);
    this.doc.commitAdd(label, `Place ${labelType}`);
    this.callbacks.requestRedraw();
  }

  // ==================== Symbol Placement ====================

  private async handlePlaceSymbol(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const libId = await this.callbacks.requestSymbolChooser();
    if (!libId) return;

    const symbol = new SchSymbol(evt.pos, libId);
    this.doc.commitAdd(symbol, "Place symbol");
    this.callbacks.requestRedraw();
  }

  // ==================== Junction Placement ====================

  private handlePlaceJunction(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const junction = new SchJunction(evt.pos);
    this.doc.commitAdd(junction, "Place junction");
    this.callbacks.requestRedraw();
  }

  // ==================== No-Connect Placement ====================

  private handlePlaceNoConnect(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const nc = new SchNoConnect(evt.pos);
    this.doc.commitAdd(nc, "Place no-connect");
    this.callbacks.requestRedraw();
  }

  // ==================== Move Tool ====================

  private handleMove(evt: ToolEvent): void {
    const startEvent = evt.type === "click" || evt.type === "mousedown";
    if (startEvent && this.moveItems.length === 0) {
      // Start move from selection
      this.moveItems = [];
      for (const id of this.selection) {
        const item = this.doc.getItem(id);
        if (item) {
          this.doc.commitModify(item);
          this.moveItems.push(item);
        }
      }
      if (this.moveItems.length === 0) return;
      this.moveOrigin = { ...evt.pos };
      this.callbacks.showStatus("Moving... Click to place");
    } else if (evt.type === "motion" && this.moveItems.length > 0) {
      const delta = vec2Sub(evt.pos, this.moveOrigin);
      for (const item of this.moveItems) {
        item.move(delta);
      }
      this.moveOrigin = { ...evt.pos };
      this.callbacks.requestRedraw();
    } else if (startEvent && this.moveItems.length > 0) {
      // Finish move
      this.doc.commitPush("Move items");
      this.moveItems = [];
      this.setTool(ToolType.SELECT);
    }
  }

  // ==================== Global Key Shortcuts ====================
  // Mirrors KiCad's action bindings

  private handleGlobalKeys(evt: ToolEvent): void {
    // Escape: cancel current operation and return to select
    if (evt.key === "Escape" && this.activeTool !== ToolType.SELECT) {
      this.cancelCurrentTool();
      this.setTool(ToolType.SELECT);
      return;
    }

    if (evt.key === "z" && evt.ctrl) {
      if (evt.shift) {
        const desc = this.doc.performRedo();
        if (desc) this.callbacks.showStatus(`Redo: ${desc}`);
      } else {
        const desc = this.doc.performUndo();
        if (desc) this.callbacks.showStatus(`Undo: ${desc}`);
      }
      this.callbacks.requestRedraw();
      return;
    }

    // Tool shortcuts (only when in select mode or no active operation)
    if (this.activeTool === ToolType.SELECT) {
      switch (evt.key) {
        case "w":
          this.setTool(ToolType.WIRE);
          break;
        case "b":
          this.setTool(ToolType.BUS);
          break;
        case "a":
          this.setTool(ToolType.SYMBOL);
          break;
        case "l":
          this.setTool(ToolType.LABEL);
          break;
        case "j":
          this.setTool(ToolType.JUNCTION);
          break;
        case "q":
          this.setTool(ToolType.NO_CONNECT);
          break;
        case "m":
          if (this.selection.size > 0) this.setTool(ToolType.MOVE);
          break;
        case "r":
          this.rotateSelection(evt.pos);
          break;
        case "x":
          this.mirrorSelectionH(evt.pos);
          break;
        case "y":
          this.mirrorSelectionV(evt.pos);
          break;
        case "Delete":
        case "Backspace":
          this.deleteSelection();
          break;
      }
    }
  }

  // ==================== Edit Operations ====================

  rotateSelection(center: Vec2): void {
    if (this.selection.size === 0) return;
    for (const id of this.selection) {
      const item = this.doc.getItem(id);
      if (item) {
        this.doc.commitModify(item);
        item.rotate(center, false);
      }
    }
    this.doc.commitPush("Rotate");
    this.callbacks.requestRedraw();
  }

  mirrorSelectionH(center: Vec2): void {
    if (this.selection.size === 0) return;
    for (const id of this.selection) {
      const item = this.doc.getItem(id);
      if (item) {
        this.doc.commitModify(item);
        item.mirrorH(center.x);
      }
    }
    this.doc.commitPush("Mirror horizontal");
    this.callbacks.requestRedraw();
  }

  mirrorSelectionV(center: Vec2): void {
    if (this.selection.size === 0) return;
    for (const id of this.selection) {
      const item = this.doc.getItem(id);
      if (item) {
        this.doc.commitModify(item);
        item.mirrorV(center.y);
      }
    }
    this.doc.commitPush("Mirror vertical");
    this.callbacks.requestRedraw();
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return;
    for (const id of this.selection) {
      const item = this.doc.getItem(id);
      if (item) {
        this.doc.undo.stage(item, ChangeType.REMOVE);
        this.doc.removeItem(item);
      }
    }
    this.doc.undo.push("Delete", () => {});
    this.selection.clear();
    this.callbacks.requestRedraw();
  }
}

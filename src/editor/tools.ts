// Tool system - thin dispatcher that delegates to individual tool classes

import type { ISymbolLibrary } from "./types";
import { SchematicDoc } from "./schematic-doc";
import { GridHelper } from "./grid";
import { ChangeType } from "./undo";
import {
  ToolType,
  type ToolEvent,
  type ToolEventType,
  type EditorCallback,
} from "./tool-types";
import type { BaseTool, ToolContext } from "./tools/base-tool";
import { SelectTool } from "./tools/select-tool";
import { WireTool } from "./tools/wire-tool";
import { LabelTool } from "./tools/label-tool";
import { SymbolTool } from "./tools/symbol-tool";
import { JunctionTool } from "./tools/junction-tool";
import { NoConnectTool } from "./tools/no-connect-tool";
import { MoveTool } from "./tools/move-tool";

// Re-export for consumers
export { ToolType, type ToolEvent, type ToolEventType, type EditorCallback };

export class ToolManager {
  doc: SchematicDoc;
  grid = new GridHelper();
  activeTool: ToolType = ToolType.SELECT;
  callbacks: EditorCallback;
  selection: Set<string> = new Set();

  private tools: Map<ToolType, BaseTool>;
  private currentTool: BaseTool;

  set symLibrary(lib: ISymbolLibrary | null) {
    const symbolTool = this.tools.get(ToolType.SYMBOL) as SymbolTool | undefined;
    if (symbolTool) symbolTool.symLibrary = lib;
  }

  constructor(doc: SchematicDoc, callbacks: EditorCallback) {
    this.doc = doc;
    this.callbacks = callbacks;

    const ctx: ToolContext = {
      doc,
      grid: this.grid,
      callbacks,
      selection: this.selection,
      setTool: (tool) => this.setTool(tool),
    };

    this.tools = new Map<ToolType, BaseTool>([
      [ToolType.SELECT, new SelectTool(ctx)],
      [ToolType.WIRE, new WireTool(ctx, ToolType.WIRE)],
      [ToolType.BUS, new WireTool(ctx, ToolType.BUS)],
      [ToolType.LABEL, new LabelTool(ctx, ToolType.LABEL)],
      [ToolType.GLOBAL_LABEL, new LabelTool(ctx, ToolType.GLOBAL_LABEL)],
      [ToolType.SYMBOL, new SymbolTool(ctx)],
      [ToolType.JUNCTION, new JunctionTool(ctx)],
      [ToolType.NO_CONNECT, new NoConnectTool(ctx)],
      [ToolType.MOVE, new MoveTool(ctx)],
    ]);

    this.currentTool = this.tools.get(ToolType.SELECT)!;
  }

  // ==================== Tool Switching ====================

  setTool(tool: ToolType): void {
    this.currentTool.onDeactivate();
    this.activeTool = tool;
    this.currentTool = this.tools.get(tool) ?? this.tools.get(ToolType.SELECT)!;
    this.currentTool.onActivate();
    this.callbacks.setCursor(tool === ToolType.SELECT ? "default" : "crosshair");
    this.callbacks.showStatus(`Tool: ${tool}`);
  }

  cancelCurrentTool(): void {
    this.currentTool.onDeactivate();
    this.callbacks.requestRedraw();
  }

  // ==================== Event Dispatch ====================

  handleEvent(evt: ToolEvent): void {
    this.currentTool.handleEvent(evt);

    if (evt.type === "keydown") {
      this.handleGlobalKeys(evt);
    }
  }

  // ==================== Global Key Shortcuts ====================

  private handleGlobalKeys(evt: ToolEvent): void {
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

  rotateSelection(center: { x: number; y: number }): void {
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

  mirrorSelectionH(center: { x: number; y: number }): void {
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

  mirrorSelectionV(center: { x: number; y: number }): void {
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
    this.doc.commitPush("Delete");
    this.selection.clear();
    this.callbacks.requestRedraw();
  }
}

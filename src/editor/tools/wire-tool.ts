import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { SchLine, SchJunction } from "../items";
import { LineMode, type Vec2 } from "../types";
import { ChangeType } from "../undo";

export class WireTool extends BaseTool {
  readonly type: ToolType;

  private wireSegments: SchLine[] = [];
  private wirePosture = false;
  lineMode: LineMode = LineMode.ORTHO_90;
  private layer: "wire" | "bus";

  constructor(ctx: ConstructorParameters<typeof BaseTool>[0], toolType: ToolType.WIRE | ToolType.BUS) {
    super(ctx);
    this.type = toolType;
    this.layer = toolType === ToolType.BUS ? "bus" : "wire";
  }

  onDeactivate(): void {
    if (this.wireSegments.length > 0) {
      for (const seg of this.wireSegments) {
        this.ctx.doc.removeItem(seg);
      }
      this.wireSegments = [];
    }
    this.ctx.doc.undo.revert();
    this.ctx.callbacks.requestRedraw();
  }

  handleEvent(evt: ToolEvent): void {
    if (evt.type === "mousedown" || evt.type === "click") {
      if (this.wireSegments.length === 0) {
        this.startWire(evt.pos);
      } else {
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
        this.lineMode = (this.lineMode + 1) % 3;
        this.updateWirePreview(evt.pos);
        this.ctx.callbacks.showStatus(
          `Line mode: ${["Free", "90°", "45°"][this.lineMode]}`,
        );
      }
    }
  }

  private startWire(pos: Vec2): void {
    const seg1 = new SchLine(pos, pos, this.layer);
    const seg2 = new SchLine(pos, pos, this.layer);
    this.ctx.doc.addItem(seg1);
    this.ctx.doc.addItem(seg2);
    this.wireSegments = [seg1, seg2];
    this.wirePosture = false;
    this.ctx.callbacks.showStatus("Drawing wire... Click to place, Dbl-click/Esc to finish");
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

    this.ctx.callbacks.requestRedraw();
  }

  private computeBreakPoint(start: Vec2, cursor: Vec2): Vec2 {
    const dx = cursor.x - start.x;
    const dy = cursor.y - start.y;

    if (this.lineMode === LineMode.FREE) {
      return { ...cursor };
    }

    if (this.lineMode === LineMode.ORTHO_90) {
      if (this.wirePosture) {
        return { x: start.x, y: cursor.y };
      } else {
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
      return { x: start.x + xDir * minD, y: start.y + yDir * minD };
    } else {
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

    if (prevSeg.isNull()) {
      this.ctx.doc.removeItem(prevSeg);
      this.wireSegments.splice(this.wireSegments.length - 2, 1);
    }

    const connected = this.ctx.doc.findConnectableAt(pos, lastSeg);
    if (connected.length > 0 && this.wireSegments.length > 1) {
      lastSeg.end = pos;
      if (!lastSeg.isNull()) {
        this.finishWire();
        return;
      }
    }

    const newSeg1 = new SchLine(pos, pos, this.layer);
    const newSeg2 = new SchLine(pos, pos, this.layer);
    this.ctx.doc.addItem(newSeg1);
    this.ctx.doc.addItem(newSeg2);
    this.wireSegments.push(newSeg1, newSeg2);
    this.wirePosture = false;
  }

  private undoLastWireSegment(): void {
    if (this.wireSegments.length <= 2) return;
    const removed1 = this.wireSegments.pop()!;
    const removed2 = this.wireSegments.pop()!;
    this.ctx.doc.removeItem(removed1);
    this.ctx.doc.removeItem(removed2);
    this.ctx.callbacks.requestRedraw();
  }

  private finishWire(): void {
    const toKeep: SchLine[] = [];
    for (const seg of this.wireSegments) {
      if (!seg.isNull()) {
        toKeep.push(seg);
      } else {
        this.ctx.doc.removeItem(seg);
      }
    }

    for (const seg of toKeep) {
      for (const cp of seg.getConnectionPoints()) {
        if (this.ctx.doc.needsJunction(cp) && !this.ctx.doc.hasJunctionAt(cp)) {
          const junction = new SchJunction(cp);
          this.ctx.doc.addItem(junction);
          this.ctx.doc.undo.stage(junction, ChangeType.ADD);
        }
      }
    }

    for (const seg of toKeep) {
      this.ctx.doc.undo.stage(seg, ChangeType.ADD);
    }

    this.ctx.doc.commitPush("Draw wire");
    this.wireSegments = [];
    this.ctx.callbacks.requestRedraw();
    this.ctx.callbacks.showStatus("Wire placed");
  }
}

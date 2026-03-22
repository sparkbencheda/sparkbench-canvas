import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { SchItem } from "../items";
import { vec2Sub } from "../types";
import type { Vec2 } from "../types";

export class SelectTool extends BaseTool {
  readonly type = ToolType.SELECT;

  private moveItems: SchItem[] = [];
  private moveOrigin: Vec2 = { x: 0, y: 0 };
  private isDragging = false;
  private dragStartPos: Vec2 = { x: 0, y: 0 };
  private mouseDown = false;
  private dragThreshold = 0.5;

  onDeactivate(): void {
    this.moveItems = [];
    this.isDragging = false;
    this.mouseDown = false;
  }

  handleEvent(evt: ToolEvent): void {
    if (evt.type === "mousedown") {
      this.mouseDown = true;
      this.isDragging = false;
      this.dragStartPos = { ...evt.pos };

      const hits = this.ctx.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);

      if (topHit) {
        if (evt.shift) {
          if (this.ctx.selection.has(topHit.id)) {
            this.ctx.selection.delete(topHit.id);
          } else {
            this.ctx.selection.add(topHit.id);
          }
        } else if (!this.ctx.selection.has(topHit.id)) {
          this.ctx.selection.clear();
          this.ctx.selection.add(topHit.id);
        }
      } else if (!evt.shift) {
        this.ctx.selection.clear();
      }
      this.ctx.callbacks.requestRedraw();
    }

    if (evt.type === "motion" && this.mouseDown) {
      const dx = evt.pos.x - this.dragStartPos.x;
      const dy = evt.pos.y - this.dragStartPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.isDragging && dist > this.dragThreshold && this.ctx.selection.size > 0) {
        this.isDragging = true;
        this.moveItems = [];
        for (const id of this.ctx.selection) {
          const item = this.ctx.doc.getItem(id);
          if (item) {
            this.ctx.doc.commitModify(item);
            this.moveItems.push(item);
          }
        }
        this.moveOrigin = { ...this.dragStartPos };
        this.ctx.callbacks.setCursor("grabbing");
        this.ctx.callbacks.showStatus("Dragging...");
      }

      if (this.isDragging && this.moveItems.length > 0) {
        const delta = vec2Sub(evt.pos, this.moveOrigin);
        for (const item of this.moveItems) {
          item.move(delta);
        }
        this.moveOrigin = { ...evt.pos };
        this.ctx.callbacks.requestRedraw();
      }
    }

    if (evt.type === "mouseup") {
      if (this.isDragging && this.moveItems.length > 0) {
        this.ctx.doc.commitPush("Move items");
        this.moveItems = [];
        this.isDragging = false;
        this.ctx.callbacks.setCursor("default");
        this.ctx.callbacks.showStatus("Moved");
      }
      this.mouseDown = false;
      this.isDragging = false;
      this.ctx.callbacks.requestRedraw();
    }

    if (evt.type === "dblclick") {
      const hits = this.ctx.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);
      if (topHit) {
        this.ctx.callbacks.showStatus(`Properties: ${topHit.itemType} ${topHit.id}`);
      }
    }
  }

  private pickBest(hits: SchItem[]): SchItem | null {
    if (hits.length === 0) return null;
    const priority: Record<string, number> = {
      junction: 0, no_connect: 0, label: 1, global_label: 1,
      hier_label: 1, wire: 2, bus: 3, symbol: 4, sheet: 5,
    };
    hits.sort((a, b) => (priority[a.itemType] ?? 9) - (priority[b.itemType] ?? 9));
    return hits[0] ?? null;
  }
}

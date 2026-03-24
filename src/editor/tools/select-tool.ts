import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { SchItem } from "../items";
import { vec2Sub } from "../types";
import type { Vec2, BBox } from "../types";

export class SelectTool extends BaseTool {
  readonly type = ToolType.SELECT;

  private moveItems: SchItem[] = [];
  private moveOrigin: Vec2 = { x: 0, y: 0 };
  private isDragging = false;
  private isMarquee = false;
  private dragStartPos: Vec2 = { x: 0, y: 0 };
  private mouseDown = false;
  private hitOnDown = false;
  private dragThreshold = 0.5;

  /** Current marquee rectangle in world coords, or null if not active */
  marqueeRect: BBox | null = null;

  onDeactivate(): void {
    this.moveItems = [];
    this.isDragging = false;
    this.isMarquee = false;
    this.marqueeRect = null;
    this.mouseDown = false;
  }

  handleEvent(evt: ToolEvent): void {
    if (evt.type === "mousedown") {
      this.mouseDown = true;
      this.isDragging = false;
      this.isMarquee = false;
      this.marqueeRect = null;
      this.dragStartPos = { ...evt.pos };

      const hits = this.ctx.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);
      this.hitOnDown = !!topHit;

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

      // Start move drag (when items are selected and we clicked on one)
      if (!this.isDragging && !this.isMarquee && dist > this.dragThreshold && this.hitOnDown && this.ctx.selection.size > 0) {
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

      // Start marquee drag (when we clicked on empty space)
      if (!this.isDragging && !this.isMarquee && dist > this.dragThreshold && !this.hitOnDown) {
        this.isMarquee = true;
        this.ctx.callbacks.setCursor("crosshair");
      }

      if (this.isDragging && this.moveItems.length > 0) {
        const delta = vec2Sub(evt.pos, this.moveOrigin);
        for (const item of this.moveItems) {
          item.move(delta);
        }
        this.moveOrigin = { ...evt.pos };
        this.ctx.callbacks.requestRedraw();
      }

      if (this.isMarquee) {
        const x = Math.min(this.dragStartPos.x, evt.pos.x);
        const y = Math.min(this.dragStartPos.y, evt.pos.y);
        const w = Math.abs(evt.pos.x - this.dragStartPos.x);
        const h = Math.abs(evt.pos.y - this.dragStartPos.y);
        this.marqueeRect = { x, y, width: w, height: h };
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

      if (this.isMarquee && this.marqueeRect) {
        const items = this.ctx.doc.itemsInArea(this.marqueeRect);
        if (!evt.shift) this.ctx.selection.clear();
        for (const item of items) {
          this.ctx.selection.add(item.id);
        }
        this.isMarquee = false;
        this.marqueeRect = null;
        this.ctx.callbacks.setCursor("default");
        const count = this.ctx.selection.size;
        if (count > 0) this.ctx.callbacks.showStatus(`Selected ${count} item${count > 1 ? "s" : ""}`);
      }

      this.mouseDown = false;
      this.isDragging = false;
      this.isMarquee = false;
      this.marqueeRect = null;
      this.ctx.callbacks.requestRedraw();
    }

    if (evt.type === "dblclick") {
      const hits = this.ctx.doc.hitTest(evt.pos, 2);
      const topHit = this.pickBest(hits);
      if (topHit) {
        this.ctx.callbacks.editProperties(topHit);
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

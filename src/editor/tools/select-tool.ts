import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { EditableItem } from "../../kicanvas/kicad/schematic-edit";
import type { Vec2 } from "../../kicanvas/base/math";

export class SelectTool extends BaseTool {
  readonly type = ToolType.SELECT;

  private moveItems: EditableItem[] = [];
  private moveOrigin: Vec2Like = { x: 0, y: 0 };
  private isDragging = false;
  private isMarquee = false;
  private dragStartPos: Vec2Like = { x: 0, y: 0 };
  private mouseDown = false;
  private hitOnDown = false;
  private dragThreshold = 0.5;

  /** Current marquee rectangle in world coords, or null if not active */
  marqueeRect: { x: number; y: number; width: number; height: number } | null = null;

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
      this.dragStartPos = { x: evt.pos.x, y: evt.pos.y };

      // Use hits from viewer layer queries if available, otherwise empty
      const topHit = this.pickBestFromHits(evt.hits);
      this.hitOnDown = !!topHit;

      if (topHit) {
        if (evt.shift) {
          if (this.ctx.selection.has(topHit)) {
            this.ctx.selection.delete(topHit);
          } else {
            this.ctx.selection.add(topHit);
          }
        } else if (!this.ctx.selection.has(topHit)) {
          this.ctx.selection.clear();
          this.ctx.selection.add(topHit);
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

      if (!this.isDragging && !this.isMarquee && dist > this.dragThreshold && this.hitOnDown && this.ctx.selection.size > 0) {
        this.isDragging = true;
        this.moveItems = [];
        for (const item of this.ctx.selection) {
          this.ctx.doc.commitModify(item);
          this.moveItems.push(item);
        }
        this.moveOrigin = { x: this.dragStartPos.x, y: this.dragStartPos.y };
        this.ctx.callbacks.setCursor("grabbing");
        this.ctx.callbacks.showStatus("Dragging...");
      }

      if (!this.isDragging && !this.isMarquee && dist > this.dragThreshold && !this.hitOnDown) {
        this.isMarquee = true;
        this.ctx.callbacks.setCursor("crosshair");
      }

      if (this.isDragging && this.moveItems.length > 0) {
        const delta = { x: evt.pos.x - this.moveOrigin.x, y: evt.pos.y - this.moveOrigin.y };
        for (const item of this.moveItems) {
          item.move(delta as any);
        }
        this.moveOrigin = { x: evt.pos.x, y: evt.pos.y };
        this.ctx.callbacks.requestRepaint();
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
        this.ctx.callbacks.requestRepaint();
      }

      if (this.isMarquee && this.marqueeRect) {
        // Select items in marquee using viewer hits
        // For now, we'll rely on the viewer's selectItemsInArea being called externally
        this.isMarquee = false;
        this.marqueeRect = null;
        this.ctx.callbacks.setCursor("default");
      }

      this.mouseDown = false;
      this.isDragging = false;
      this.isMarquee = false;
      this.marqueeRect = null;
      this.ctx.callbacks.requestRedraw();
    }

    if (evt.type === "dblclick") {
      const topHit = this.pickBestFromHits(evt.hits);
      if (topHit) {
        this.ctx.callbacks.editProperties(topHit);
      }
    }
  }

  private pickBestFromHits(hits?: Array<{ item: any; bbox: any }>): EditableItem | null {
    if (!hits || hits.length === 0) return null;
    // Return the first hit (viewer already orders by layer priority)
    return hits[0]!.item as EditableItem;
  }
}

interface Vec2Like { x: number; y: number }

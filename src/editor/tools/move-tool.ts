import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { SchItem } from "../items";
import { vec2Sub, type Vec2 } from "../types";

export class MoveTool extends BaseTool {
  readonly type = ToolType.MOVE;

  private moveItems: SchItem[] = [];
  private moveOrigin: Vec2 = { x: 0, y: 0 };

  onDeactivate(): void {
    this.moveItems = [];
  }

  handleEvent(evt: ToolEvent): void {
    const startEvent = evt.type === "click" || evt.type === "mousedown";
    if (startEvent && this.moveItems.length === 0) {
      this.moveItems = [];
      for (const id of this.ctx.selection) {
        const item = this.ctx.doc.getItem(id);
        if (item) {
          this.ctx.doc.commitModify(item);
          this.moveItems.push(item);
        }
      }
      if (this.moveItems.length === 0) return;
      this.moveOrigin = { ...evt.pos };
      this.ctx.callbacks.showStatus("Moving... Click to place");
    } else if (evt.type === "motion" && this.moveItems.length > 0) {
      const delta = vec2Sub(evt.pos, this.moveOrigin);
      for (const item of this.moveItems) {
        item.move(delta);
      }
      this.moveOrigin = { ...evt.pos };
      this.ctx.callbacks.requestRedraw();
    } else if (startEvent && this.moveItems.length > 0) {
      this.ctx.doc.commitPush("Move items");
      this.moveItems = [];
      this.ctx.setTool(ToolType.SELECT);
    }
  }
}

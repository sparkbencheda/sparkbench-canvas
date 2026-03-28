import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { EditableItem } from "../../kicanvas/kicad/schematic-edit";

export class MoveTool extends BaseTool {
  readonly type = ToolType.MOVE;

  private moveItems: EditableItem[] = [];
  private moveOrigin: { x: number; y: number } = { x: 0, y: 0 };

  onDeactivate(): void {
    this.moveItems = [];
  }

  handleEvent(evt: ToolEvent): void {
    const startEvent = evt.type === "click" || evt.type === "mousedown";
    if (startEvent && this.moveItems.length === 0) {
      this.moveItems = [];
      for (const item of this.ctx.selection) {
        this.ctx.doc.commitModify(item);
        this.moveItems.push(item);
      }
      if (this.moveItems.length === 0) return;
      this.moveOrigin = { x: evt.pos.x, y: evt.pos.y };
      this.ctx.callbacks.showStatus("Moving... Click to place");
    } else if (evt.type === "motion" && this.moveItems.length > 0) {
      const delta = { x: evt.pos.x - this.moveOrigin.x, y: evt.pos.y - this.moveOrigin.y };
      for (const item of this.moveItems) {
        item.move(delta as any);
      }
      this.moveOrigin = { x: evt.pos.x, y: evt.pos.y };
      this.ctx.callbacks.requestRepaint();
    } else if (startEvent && this.moveItems.length > 0) {
      this.ctx.doc.commitPush("Move items");
      this.moveItems = [];
      this.ctx.setTool(ToolType.SELECT);
    }
  }
}

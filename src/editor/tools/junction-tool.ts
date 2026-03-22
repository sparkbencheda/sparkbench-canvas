import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { SchJunction } from "../items";

export class JunctionTool extends BaseTool {
  readonly type = ToolType.JUNCTION;

  handleEvent(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const junction = new SchJunction(evt.pos);
    this.ctx.doc.commitAdd(junction, "Place junction");
    this.ctx.callbacks.requestRedraw();
  }
}

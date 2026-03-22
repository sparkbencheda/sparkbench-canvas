import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { SchNoConnect } from "../items";

export class NoConnectTool extends BaseTool {
  readonly type = ToolType.NO_CONNECT;

  handleEvent(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const nc = new SchNoConnect(evt.pos);
    this.ctx.doc.commitAdd(nc, "Place no-connect");
    this.ctx.callbacks.requestRedraw();
  }
}

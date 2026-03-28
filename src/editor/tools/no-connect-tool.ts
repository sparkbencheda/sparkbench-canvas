import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { KicadSchDoc } from "../kicad-sch-doc";
import { Vec2 } from "../../kicanvas/base/math";

export class NoConnectTool extends BaseTool {
  readonly type = ToolType.NO_CONNECT;

  handleEvent(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const pos = evt.pos instanceof Vec2 ? evt.pos : new Vec2(evt.pos.x, evt.pos.y);
    const nc = KicadSchDoc.createNoConnect(pos);
    this.ctx.doc.commitAdd(nc as any, "Place no-connect");
    this.ctx.callbacks.requestRepaint();
  }
}

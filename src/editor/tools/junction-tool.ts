import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { KicadSchDoc } from "../kicad-sch-doc";
import { Vec2 } from "../../kicanvas/base/math";

export class JunctionTool extends BaseTool {
  readonly type = ToolType.JUNCTION;

  handleEvent(evt: ToolEvent): void {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const pos = evt.pos instanceof Vec2 ? evt.pos : new Vec2(evt.pos.x, evt.pos.y);
    const junction = KicadSchDoc.createJunction(pos);
    this.ctx.doc.commitAdd(junction as any, "Place junction");
    this.ctx.callbacks.requestRepaint();
  }
}

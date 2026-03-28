import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { KicadSchDoc } from "../kicad-sch-doc";
import { Vec2 } from "../../kicanvas/base/math";

export class LabelTool extends BaseTool {
  readonly type: ToolType;
  private isGlobal: boolean;

  constructor(ctx: ConstructorParameters<typeof BaseTool>[0], toolType: ToolType.LABEL | ToolType.GLOBAL_LABEL) {
    super(ctx);
    this.type = toolType;
    this.isGlobal = toolType === ToolType.GLOBAL_LABEL;
  }

  async handleEvent(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const text = await this.ctx.callbacks.requestLabelText();
    if (!text) return;

    const pos = evt.pos instanceof Vec2 ? evt.pos : new Vec2(evt.pos.x, evt.pos.y);

    const label = this.isGlobal
      ? KicadSchDoc.createGlobalLabel(pos, text)
      : KicadSchDoc.createNetLabel(pos, text);

    this.ctx.doc.commitAdd(label as any, `Place ${this.isGlobal ? "global_label" : "label"}`);
    this.ctx.callbacks.requestRepaint();
  }
}

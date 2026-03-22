import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { SchLabel } from "../items";

export class LabelTool extends BaseTool {
  readonly type: ToolType;
  private labelType: "label" | "global_label";

  constructor(ctx: ConstructorParameters<typeof BaseTool>[0], toolType: ToolType.LABEL | ToolType.GLOBAL_LABEL) {
    super(ctx);
    this.type = toolType;
    this.labelType = toolType === ToolType.GLOBAL_LABEL ? "global_label" : "label";
  }

  async handleEvent(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const text = await this.ctx.callbacks.requestLabelText();
    if (!text) return;

    const label = new SchLabel(evt.pos, text, this.labelType);
    this.ctx.doc.commitAdd(label, `Place ${this.labelType}`);
    this.ctx.callbacks.requestRedraw();
  }
}

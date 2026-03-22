import type { SchematicDoc } from "../schematic-doc";
import type { GridHelper } from "../grid";
import type { ToolType, EditorCallback, ToolEvent } from "../tool-types";

export interface ToolContext {
  doc: SchematicDoc;
  grid: GridHelper;
  callbacks: EditorCallback;
  selection: Set<string>;
  setTool: (tool: ToolType) => void;
}

export abstract class BaseTool {
  abstract readonly type: ToolType;
  protected ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  abstract handleEvent(evt: ToolEvent): void;

  /** Called when this tool becomes active */
  onActivate(): void {}

  /** Called when this tool is deactivated. Should clean up any in-progress state. */
  onDeactivate(): void {}
}

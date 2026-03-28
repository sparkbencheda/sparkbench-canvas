import type { KicadSchDoc } from "../kicad-sch-doc";
import type { GridHelper } from "../grid";
import type { ToolType, EditorCallback, ToolEvent } from "../tool-types";
import type { EditableItem } from "../../kicanvas/kicad/schematic-edit";
import type { EditableSchematicViewer } from "../../kicanvas/viewers/schematic/editable-viewer";

export interface ToolContext {
  doc: KicadSchDoc;
  grid: GridHelper;
  callbacks: EditorCallback;
  selection: Set<EditableItem>;
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

  /** Optional: paint overlay (wire preview, marquee, etc.) via the viewer's renderer */
  paintOverlay?(viewer: EditableSchematicViewer): void;
}

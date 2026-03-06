// SparkBench Canvas - Schematic Editor Core
// Modeled after KiCad's eeschema architecture

export { type Vec2, type BBox, LineMode, LabelShape, SpinStyle } from "./types";
export { vec2, vec2Add, vec2Sub, vec2Eq, vec2Dist } from "./types";

export {
  SchItem,
  SchLine,
  SchJunction,
  SchLabel,
  SchNoConnect,
  SchSymbol,
  SchSheet,
  type SymbolPin,
  type SymbolField,
} from "./items";

export { SchematicDoc } from "./schematic-doc";
export { UndoStack, ChangeType } from "./undo";
export { GridHelper, SnapMode } from "./grid";
export {
  ToolManager,
  ToolType,
  type ToolEvent,
  type EditorCallback,
} from "./tools";

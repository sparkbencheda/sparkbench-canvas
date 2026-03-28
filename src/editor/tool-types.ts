// Shared types for the tool system

import type { Vec2, BBox } from "../kicanvas/base/math";
import type { EditableItem } from "../kicanvas/kicad/schematic-edit";

export type ToolEventType =
  | "click"
  | "dblclick"
  | "mousedown"
  | "mouseup"
  | "motion"
  | "keydown"
  | "keyup";

export interface ToolEvent {
  type: ToolEventType;
  pos: Vec2;        // World coordinates (snapped)
  rawPos: Vec2;     // World coordinates (unsnapped)
  key?: string;
  shift?: boolean;
  ctrl?: boolean;
  button?: number;
  /** Items under cursor from viewer layer queries */
  hits?: Array<{ item: any; bbox: BBox }>;
}

export enum ToolType {
  SELECT = "select",
  WIRE = "wire",
  BUS = "bus",
  LABEL = "label",
  GLOBAL_LABEL = "global_label",
  SYMBOL = "symbol",
  JUNCTION = "junction",
  NO_CONNECT = "no_connect",
  MOVE = "move",
}

export type EditorCallback = {
  requestRedraw: () => void;
  requestRepaint: () => void;
  requestSymbolChooser: () => Promise<string | null>;
  requestLabelText: (current?: string) => Promise<string | null>;
  showStatus: (msg: string) => void;
  setCursor: (cursor: string) => void;
  editProperties: (item: EditableItem) => void;
};

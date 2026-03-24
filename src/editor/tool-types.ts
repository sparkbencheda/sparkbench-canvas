// Shared types for the tool system

import type { Vec2 } from "./types";
import type { SchItem } from "./items";

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
  requestSymbolChooser: () => Promise<string | null>;
  requestLabelText: (current?: string) => Promise<string | null>;
  showStatus: (msg: string) => void;
  setCursor: (cursor: string) => void;
  editProperties: (item: SchItem) => void;
};

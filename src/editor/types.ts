// Core types for the schematic editor, modeled after KiCad's eeschema

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Eq(a: Vec2, b: Vec2, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

export function vec2Dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function bboxContains(bb: BBox, p: Vec2): boolean {
  return p.x >= bb.x && p.x <= bb.x + bb.width && p.y >= bb.y && p.y <= bb.y + bb.height;
}

export function bboxFromPoints(points: Vec2[]): BBox {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type SchItemType =
  | "wire"
  | "bus"
  | "junction"
  | "label"
  | "global_label"
  | "hier_label"
  | "no_connect"
  | "symbol"
  | "sheet"
  | "sheet_pin"
  | "text"
  | "textbox"
  | "shape"
  | "bus_entry"
  | "group";

export enum LineMode {
  FREE = 0,
  ORTHO_90 = 1,
  ANGLE_45 = 2,
}

export enum LabelShape {
  INPUT = 0,
  OUTPUT = 1,
  BIDI = 2,
  TRISTATE = 3,
  UNSPECIFIED = 4,
}

export enum SpinStyle {
  LEFT = 0,
  UP = 1,
  RIGHT = 2,
  DOWN = 3,
}

export interface StrokeParams {
  width: number;
  color?: string;
  style?: "solid" | "dash" | "dot" | "dash_dot";
}

// Flags for items during editing operations
export const IS_NEW = 1 << 0;
export const IS_MOVING = 1 << 1;
export const IS_SELECTED = 1 << 2;
export const IS_DRAGGING = 1 << 3;

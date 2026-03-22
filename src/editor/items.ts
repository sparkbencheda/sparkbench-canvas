// Schematic item data model - mirrors KiCad's SCH_ITEM hierarchy

import {
  type Vec2,
  type BBox,
  type SchItemType,
  type StrokeParams,
  type LabelShape,
  type SpinStyle,
  type LibSymbol,
  vec2,
  vec2Add,
  bboxFromPoints,
} from "./types";

let nextId = 1;
function generateId(): string {
  return `item-${nextId++}-${Date.now().toString(36)}`;
}

// ==================== Base Item ====================

export abstract class SchItem {
  readonly id: string;
  abstract readonly itemType: SchItemType;
  flags: number = 0;

  constructor(id?: string) {
    this.id = id ?? generateId();
  }

  abstract clone(): SchItem;
  abstract getBBox(): BBox;
  abstract hitTest(pos: Vec2, accuracy: number): boolean;
  abstract move(delta: Vec2): void;
  abstract rotate(center: Vec2, ccw: boolean): void;
  abstract mirrorH(centerX: number): void;
  abstract mirrorV(centerY: number): void;
  abstract getConnectionPoints(): Vec2[];

  isConnectable(): boolean {
    return false;
  }
}

// ==================== Wire / Bus / Graphic Line ====================

export type LineLayer = "wire" | "bus" | "notes";

export class SchLine extends SchItem {
  readonly itemType: SchItemType;
  start: Vec2;
  end: Vec2;
  layer: LineLayer;
  stroke: StrokeParams;
  originalUuid?: string;  // For polyline reconstruction on export
  segmentIndex?: number;

  constructor(start: Vec2, end: Vec2, layer: LineLayer = "wire", id?: string) {
    super(id);
    this.start = { ...start };
    this.end = { ...end };
    this.layer = layer;
    this.itemType = layer === "bus" ? "bus" : "wire";
    this.stroke = {
      width: layer === "bus" ? 0.3 : 0.15,
      style: "solid",
    };
  }

  clone(): SchLine {
    const c = new SchLine(this.start, this.end, this.layer);
    c.stroke = { ...this.stroke };
    c.flags = this.flags;
    c.originalUuid = this.originalUuid;
    c.segmentIndex = this.segmentIndex;
    return c;
  }

  getBBox(): BBox {
    return bboxFromPoints([this.start, this.end]);
  }

  hitTest(pos: Vec2, accuracy = 0.5): boolean {
    return distToSegment(pos, this.start, this.end) <= accuracy;
  }

  move(delta: Vec2): void {
    this.start = vec2Add(this.start, delta);
    this.end = vec2Add(this.end, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.start = rotatePoint(this.start, center, ccw);
    this.end = rotatePoint(this.end, center, ccw);
  }

  mirrorH(centerX: number): void {
    this.start = { x: 2 * centerX - this.start.x, y: this.start.y };
    this.end = { x: 2 * centerX - this.end.x, y: this.end.y };
  }

  mirrorV(centerY: number): void {
    this.start = { x: this.start.x, y: 2 * centerY - this.start.y };
    this.end = { x: this.end.x, y: 2 * centerY - this.end.y };
  }

  getConnectionPoints(): Vec2[] {
    return [{ ...this.start }, { ...this.end }];
  }

  override isConnectable(): boolean {
    return true;
  }

  isNull(): boolean {
    return Math.abs(this.start.x - this.end.x) < 0.001 &&
      Math.abs(this.start.y - this.end.y) < 0.001;
  }

  angle(): number {
    return Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
  }

  isOrthogonal(): boolean {
    const a = Math.abs(this.angle());
    return a < 0.01 || Math.abs(a - Math.PI / 2) < 0.01 ||
      Math.abs(a - Math.PI) < 0.01 || Math.abs(a - 3 * Math.PI / 2) < 0.01;
  }

  midPoint(): Vec2 {
    return {
      x: (this.start.x + this.end.x) / 2,
      y: (this.start.y + this.end.y) / 2,
    };
  }
}

// ==================== Junction ====================

export class SchJunction extends SchItem {
  readonly itemType = "junction";
  pos: Vec2;
  diameter: number;

  constructor(pos: Vec2, diameter = 1.0, id?: string) {
    super(id);
    this.pos = { ...pos };
    this.diameter = diameter;
  }

  clone(): SchJunction {
    return new SchJunction(this.pos, this.diameter);
  }

  getBBox(): BBox {
    const r = this.diameter / 2;
    return { x: this.pos.x - r, y: this.pos.y - r, width: this.diameter, height: this.diameter };
  }

  hitTest(pos: Vec2, accuracy = 0.5): boolean {
    const dx = pos.x - this.pos.x;
    const dy = pos.y - this.pos.y;
    return Math.sqrt(dx * dx + dy * dy) <= this.diameter / 2 + accuracy;
  }

  move(delta: Vec2): void {
    this.pos = vec2Add(this.pos, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.pos = rotatePoint(this.pos, center, ccw);
  }

  mirrorH(centerX: number): void {
    this.pos = { x: 2 * centerX - this.pos.x, y: this.pos.y };
  }

  mirrorV(centerY: number): void {
    this.pos = { x: this.pos.x, y: 2 * centerY - this.pos.y };
  }

  getConnectionPoints(): Vec2[] {
    return [{ ...this.pos }];
  }

  override isConnectable(): boolean {
    return true;
  }
}

// ==================== Label ====================

export class SchLabel extends SchItem {
  readonly itemType: SchItemType;
  pos: Vec2;
  text: string;
  labelType: "label" | "global_label" | "hier_label";
  shape: LabelShape;
  spin: SpinStyle;

  constructor(
    pos: Vec2,
    text: string,
    labelType: "label" | "global_label" | "hier_label" = "label",
    id?: string,
  ) {
    super(id);
    this.itemType = labelType as SchItemType;
    this.pos = { ...pos };
    this.text = text;
    this.labelType = labelType;
    this.shape = 4; // UNSPECIFIED
    this.spin = 0; // LEFT
  }

  clone(): SchLabel {
    const c = new SchLabel(this.pos, this.text, this.labelType);
    c.shape = this.shape;
    c.spin = this.spin;
    c.flags = this.flags;
    return c;
  }

  getBBox(): BBox {
    // Approximate - real size depends on text rendering
    const textW = this.text.length * 1.0 + 2;
    const h = 2.54;

    // Extend bbox in the direction the text goes based on spin
    switch (this.spin) {
      case 0: // LEFT: text extends right
        return { x: this.pos.x, y: this.pos.y - h / 2, width: textW, height: h };
      case 1: // UP: text extends upward
        return { x: this.pos.x - h / 2, y: this.pos.y - textW, width: h, height: textW };
      case 2: // RIGHT: text extends left
        return { x: this.pos.x - textW, y: this.pos.y - h / 2, width: textW, height: h };
      case 3: // DOWN: text extends downward
        return { x: this.pos.x - h / 2, y: this.pos.y, width: h, height: textW };
      default:
        return { x: this.pos.x - textW / 2, y: this.pos.y - h / 2, width: textW, height: h };
    }
  }

  hitTest(pos: Vec2, accuracy = 1): boolean {
    const bb = this.getBBox();
    return pos.x >= bb.x - accuracy && pos.x <= bb.x + bb.width + accuracy &&
      pos.y >= bb.y - accuracy && pos.y <= bb.y + bb.height + accuracy;
  }

  move(delta: Vec2): void {
    this.pos = vec2Add(this.pos, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.pos = rotatePoint(this.pos, center, ccw);
    this.spin = ((this.spin + (ccw ? 3 : 1)) % 4) as SpinStyle;
  }

  mirrorH(centerX: number): void {
    this.pos = { x: 2 * centerX - this.pos.x, y: this.pos.y };
  }

  mirrorV(centerY: number): void {
    this.pos = { x: this.pos.x, y: 2 * centerY - this.pos.y };
  }

  getConnectionPoints(): Vec2[] {
    return [{ ...this.pos }];
  }

  override isConnectable(): boolean {
    return true;
  }
}

// ==================== No-Connect ====================

export class SchNoConnect extends SchItem {
  readonly itemType = "no_connect";
  pos: Vec2;

  constructor(pos: Vec2, id?: string) {
    super(id);
    this.pos = { ...pos };
  }

  clone(): SchNoConnect {
    return new SchNoConnect(this.pos);
  }

  getBBox(): BBox {
    return { x: this.pos.x - 0.635, y: this.pos.y - 0.635, width: 1.27, height: 1.27 };
  }

  hitTest(pos: Vec2, accuracy = 0.5): boolean {
    return Math.abs(pos.x - this.pos.x) <= 0.635 + accuracy &&
      Math.abs(pos.y - this.pos.y) <= 0.635 + accuracy;
  }

  move(delta: Vec2): void {
    this.pos = vec2Add(this.pos, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.pos = rotatePoint(this.pos, center, ccw);
  }

  mirrorH(centerX: number): void {
    this.pos = { x: 2 * centerX - this.pos.x, y: this.pos.y };
  }

  mirrorV(centerY: number): void {
    this.pos = { x: this.pos.x, y: 2 * centerY - this.pos.y };
  }

  getConnectionPoints(): Vec2[] {
    return [{ ...this.pos }];
  }

  override isConnectable(): boolean {
    return true;
  }
}

// ==================== Symbol Instance ====================

export interface SymbolPin {
  number: string;
  name: string;
  pos: Vec2; // Relative to symbol origin
  type: "input" | "output" | "bidirectional" | "passive" | "power" | "unspecified";
}

export interface SymbolField {
  name: string;
  text: string;
  pos: Vec2; // Relative to symbol origin
  visible: boolean;
}

export class SchSymbol extends SchItem {
  readonly itemType = "symbol";
  pos: Vec2;
  libId: string; // Library reference (e.g., "Device:R")
  unit: number;
  bodyStyle: number;
  rotation: number; // 0, 90, 180, 270
  mirror: "none" | "x" | "y";
  fields: SymbolField[];
  pins: SymbolPin[];
  libSymbol: LibSymbol | null;

  constructor(pos: Vec2, libId: string, id?: string) {
    super(id);
    this.pos = { ...pos };
    this.libId = libId;
    this.unit = 1;
    this.bodyStyle = 1;
    this.rotation = 0;
    this.mirror = "none";
    this.fields = [
      { name: "Reference", text: "?", pos: vec2(0, -2.54), visible: true },
      { name: "Value", text: libId.split(":").pop() ?? libId, pos: vec2(0, 2.54), visible: true },
      { name: "Footprint", text: "", pos: vec2(0, 5.08), visible: false },
    ];
    this.pins = [];
    this.libSymbol = null;
  }

  get reference(): string {
    return this.fields.find((f) => f.name === "Reference")?.text ?? "?";
  }

  set reference(val: string) {
    const f = this.fields.find((f) => f.name === "Reference");
    if (f) f.text = val;
  }

  get value(): string {
    return this.fields.find((f) => f.name === "Value")?.text ?? "";
  }

  set value(val: string) {
    const f = this.fields.find((f) => f.name === "Value");
    if (f) f.text = val;
  }

  clone(): SchSymbol {
    const c = new SchSymbol(this.pos, this.libId);
    c.unit = this.unit;
    c.bodyStyle = this.bodyStyle;
    c.rotation = this.rotation;
    c.mirror = this.mirror;
    c.fields = this.fields.map((f) => ({ ...f, pos: { ...f.pos } }));
    c.pins = this.pins.map((p) => ({ ...p, pos: { ...p.pos } }));
    c.libSymbol = this.libSymbol;
    c.flags = this.flags;
    return c;
  }

  getBBox(): BBox {
    // Try libSymbol drawing bounds first
    if (this.libSymbol) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const collectBounds = (sym: any) => {
        for (const d of sym.drawings ?? []) {
          if (d.start && d.end) { // Rectangle
            for (const p of [d.start, d.end]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
          } else if (d.pts) { // Polyline
            for (const p of d.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
          } else if (d.center && d.radius != null) { // Circle
            minX = Math.min(minX, d.center.x - d.radius); minY = Math.min(minY, d.center.y - d.radius);
            maxX = Math.max(maxX, d.center.x + d.radius); maxY = Math.max(maxY, d.center.y + d.radius);
          } else if (d.start && d.mid && d.end) { // Arc
            for (const p of [d.start, d.mid, d.end]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
          }
        }
        for (const pin of sym.pins ?? []) {
          if (pin.at) {
            const px = pin.at.position.x, py = pin.at.position.y;
            minX = Math.min(minX, px); minY = Math.min(minY, py);
            maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
            // Extend by pin length
            const len = pin.length ?? 0;
            const rot = pin.at.rotation ?? 0;
            const ex = px + len * Math.cos((rot * Math.PI) / 180);
            const ey = py - len * Math.sin((rot * Math.PI) / 180);
            minX = Math.min(minX, ex); minY = Math.min(minY, ey);
            maxX = Math.max(maxX, ex); maxY = Math.max(maxY, ey);
          }
        }
      };
      collectBounds(this.libSymbol);
      for (const child of this.libSymbol.children ?? []) {
        const u = child.unit ?? 0;
        if (u === 0 || u === this.unit) collectBounds(child);
      }
      if (minX !== Infinity) {
        const pad = 0.5;
        // Transform the bounds
        const corners = [
          this.transformPoint({ x: minX, y: minY }),
          this.transformPoint({ x: maxX, y: minY }),
          this.transformPoint({ x: minX, y: maxY }),
          this.transformPoint({ x: maxX, y: maxY }),
        ];
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        for (const c of corners) {
          bMinX = Math.min(bMinX, c.x); bMinY = Math.min(bMinY, c.y);
          bMaxX = Math.max(bMaxX, c.x); bMaxY = Math.max(bMaxY, c.y);
        }
        return { x: bMinX - pad, y: bMinY - pad, width: bMaxX - bMinX + pad * 2, height: bMaxY - bMinY + pad * 2 };
      }
    }
    // Calculate bbox from pin positions if available, otherwise use default
    if (this.pins.length > 0) {
      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      for (const pin of this.pins) {
        const wp = this.transformPoint(pin.pos);
        const dx = wp.x - this.pos.x;
        const dy = wp.y - this.pos.y;
        if (dx < minX) minX = dx;
        if (dy < minY) minY = dy;
        if (dx > maxX) maxX = dx;
        if (dy > maxY) maxY = dy;
      }
      const pad = 2;
      return {
        x: this.pos.x + minX - pad,
        y: this.pos.y + minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
      };
    }
    return { x: this.pos.x - 5, y: this.pos.y - 5, width: 10, height: 10 };
  }

  hitTest(pos: Vec2, accuracy = 1.5): boolean {
    const bb = this.getBBox();
    return pos.x >= bb.x - accuracy && pos.x <= bb.x + bb.width + accuracy &&
      pos.y >= bb.y - accuracy && pos.y <= bb.y + bb.height + accuracy;
  }

  move(delta: Vec2): void {
    this.pos = vec2Add(this.pos, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.pos = rotatePoint(this.pos, center, ccw);
    this.rotation = (this.rotation + (ccw ? 270 : 90)) % 360;
  }

  mirrorH(centerX: number): void {
    this.pos = { x: 2 * centerX - this.pos.x, y: this.pos.y };
    this.mirror = this.mirror === "x" ? "none" : "x";
  }

  mirrorV(centerY: number): void {
    this.pos = { x: this.pos.x, y: 2 * centerY - this.pos.y };
    this.mirror = this.mirror === "y" ? "none" : "y";
  }

  getConnectionPoints(): Vec2[] {
    return this.getPinPositions();
  }

  getPinPositions(): Vec2[] {
    return this.pins.map((pin) => this.transformPoint(pin.pos));
  }

  transformPoint(local: Vec2): Vec2 {
    let p = { ...local };
    if (this.mirror === "x") p.x = -p.x;
    if (this.mirror === "y") p.y = -p.y;
    p = rotatePointDeg(p, vec2(0, 0), this.rotation);
    return vec2Add(p, this.pos);
  }

  override isConnectable(): boolean {
    return true;
  }
}

// ==================== Sheet ====================

export class SchSheet extends SchItem {
  readonly itemType = "sheet";
  pos: Vec2;
  size: Vec2;
  name: string;
  fileName: string;
  fields: SymbolField[];

  constructor(pos: Vec2, size: Vec2, name: string, fileName: string, id?: string) {
    super(id);
    this.pos = { ...pos };
    this.size = { ...size };
    this.name = name;
    this.fileName = fileName;
    this.fields = [
      { name: "Sheetname", text: name, pos: vec2(0, -1), visible: true },
      { name: "Sheetfile", text: fileName, pos: vec2(0, size.y + 1), visible: true },
    ];
  }

  clone(): SchSheet {
    const c = new SchSheet(this.pos, this.size, this.name, this.fileName);
    c.fields = this.fields.map((f) => ({ ...f, pos: { ...f.pos } }));
    c.flags = this.flags;
    return c;
  }

  getBBox(): BBox {
    return { x: this.pos.x, y: this.pos.y, width: this.size.x, height: this.size.y };
  }

  hitTest(pos: Vec2, accuracy = 0.5): boolean {
    const bb = this.getBBox();
    return pos.x >= bb.x - accuracy && pos.x <= bb.x + bb.width + accuracy &&
      pos.y >= bb.y - accuracy && pos.y <= bb.y + bb.height + accuracy;
  }

  move(delta: Vec2): void {
    this.pos = vec2Add(this.pos, delta);
  }

  rotate(center: Vec2, ccw: boolean): void {
    this.pos = rotatePoint(this.pos, center, ccw);
  }

  mirrorH(centerX: number): void {
    this.pos = { x: 2 * centerX - this.pos.x - this.size.x, y: this.pos.y };
  }

  mirrorV(centerY: number): void {
    this.pos = { x: this.pos.x, y: 2 * centerY - this.pos.y - this.size.y };
  }

  getConnectionPoints(): Vec2[] {
    return [];
  }
}

// ==================== Geometry Helpers ====================

function rotatePoint(p: Vec2, center: Vec2, ccw: boolean): Vec2 {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  if (ccw) {
    return { x: center.x + dy, y: center.y - dx };
  } else {
    return { x: center.x - dy, y: center.y + dx };
  }
}

function rotatePointDeg(p: Vec2, center: Vec2, degrees: number): Vec2 {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

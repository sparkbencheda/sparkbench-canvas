// Canvas2D renderer for SchematicDoc items (editor overlay)

import type { SchematicDoc } from "../editor/schematic-doc";
import type { Vec2, BBox } from "../editor/types";
import { SchLine, SchJunction, SchLabel, SchNoConnect, SchSymbol, SchSheet } from "../editor/items";

const COLORS = {
  wire: "#00b300",
  bus: "#0000cc",
  junction: "#00b300",
  label: "#00b3b3",
  global_label: "#cc0000",
  no_connect: "#0000cc",
  symbol: "#994400",
  sheet: "#994499",
  selected: "#00aaff",
  grid: "#333333",
  bg: "#1a1a2e",
};

export interface ViewTransform {
  // All values in CSS pixels (not device pixels)
  offsetX: number;
  offsetY: number;
  scale: number; // CSS pixels per mm
}

export class EditorRenderer {
  private ctx: CanvasRenderingContext2D;
  private transform: ViewTransform = { offsetX: 0, offsetY: 0, scale: 4 };
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  setTransform(t: ViewTransform) {
    this.transform = t;
  }

  getTransform(): ViewTransform {
    return this.transform;
  }

  /** Resize canvas to match container, returns true if size changed */
  resize(): boolean {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    if (w === this.cssWidth && h === this.cssHeight) return false;
    this.cssWidth = w;
    this.cssHeight = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    return true;
  }

  get width() { return this.cssWidth; }
  get height() { return this.cssHeight; }

  /** Convert CSS pixel position to world coordinates */
  screenToWorld(cssX: number, cssY: number): Vec2 {
    const t = this.transform;
    return {
      x: (cssX - t.offsetX) / t.scale,
      y: (cssY - t.offsetY) / t.scale,
    };
  }

  /** Convert world coordinates to CSS pixel position */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const t = this.transform;
    return {
      x: wx * t.scale + t.offsetX,
      y: wy * t.scale + t.offsetY,
    };
  }

  clear() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawGrid(gridSize: number) {
    const ctx = this.ctx;
    const t = this.transform;
    const dpr = this.dpr;

    // Only draw grid if spacing > 8 CSS pixels
    const screenGridSize = gridSize * t.scale;
    if (screenGridSize < 8) return;

    const worldLeft = -t.offsetX / t.scale;
    const worldTop = -t.offsetY / t.scale;
    const worldRight = (this.cssWidth - t.offsetX) / t.scale;
    const worldBottom = (this.cssHeight - t.offsetY) / t.scale;

    const startX = Math.floor(worldLeft / gridSize) * gridSize;
    const startY = Math.floor(worldTop / gridSize) * gridSize;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = startX; x <= worldRight; x += gridSize) {
      const sx = x * t.scale + t.offsetX;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.cssHeight);
    }
    for (let y = startY; y <= worldBottom; y += gridSize) {
      const sy = y * t.scale + t.offsetY;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.cssWidth, sy);
    }
    ctx.stroke();
  }

  drawDoc(doc: SchematicDoc, selection: Set<string>) {
    const ctx = this.ctx;
    const t = this.transform;
    const dpr = this.dpr;

    // Set transform: DPR * (offset + scale)
    ctx.setTransform(
      dpr * t.scale, 0,
      0, dpr * t.scale,
      dpr * t.offsetX, dpr * t.offsetY,
    );

    for (const item of doc.allItems()) {
      const isSelected = selection.has(item.id);

      if (item instanceof SchLine) {
        this.drawLine(item, isSelected);
      } else if (item instanceof SchJunction) {
        this.drawJunction(item, isSelected);
      } else if (item instanceof SchLabel) {
        this.drawLabel(item, isSelected);
      } else if (item instanceof SchNoConnect) {
        this.drawNoConnect(item, isSelected);
      } else if (item instanceof SchSymbol) {
        this.drawSymbol(item, isSelected);
      } else if (item instanceof SchSheet) {
        this.drawSheet(item, isSelected);
      }
    }
  }

  private drawLine(line: SchLine, selected: boolean) {
    const ctx = this.ctx;
    const color = selected ? COLORS.selected : (line.layer === "bus" ? COLORS.bus : COLORS.wire);
    ctx.strokeStyle = color;
    ctx.lineWidth = line.layer === "bus" ? 0.3 : 0.15;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.lineTo(line.end.x, line.end.y);
    ctx.stroke();
  }

  private drawJunction(j: SchJunction, selected: boolean) {
    const ctx = this.ctx;
    ctx.fillStyle = selected ? COLORS.selected : COLORS.junction;
    ctx.beginPath();
    ctx.arc(j.pos.x, j.pos.y, j.diameter / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawLabel(label: SchLabel, selected: boolean) {
    const ctx = this.ctx;
    const color = selected ? COLORS.selected :
      (label.labelType === "global_label" ? COLORS.global_label : COLORS.label);

    ctx.fillStyle = color;

    // Draw connection point
    ctx.beginPath();
    ctx.arc(label.pos.x, label.pos.y, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Draw label text
    ctx.save();
    ctx.translate(label.pos.x, label.pos.y);

    // Rotate based on spin
    const angles = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
    ctx.rotate(angles[label.spin] ?? 0);

    ctx.font = "1.27px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(label.text, 0.5, 0);

    // Draw outline for global labels
    if (label.labelType === "global_label") {
      const w = ctx.measureText(label.text).width + 1.5;
      const h = 1.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w - 0.5, -h / 2);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - 0.5, h / 2);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawNoConnect(nc: SchNoConnect, selected: boolean) {
    const ctx = this.ctx;
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.no_connect;
    ctx.lineWidth = 0.15;
    const s = 0.635;
    ctx.beginPath();
    ctx.moveTo(nc.pos.x - s, nc.pos.y - s);
    ctx.lineTo(nc.pos.x + s, nc.pos.y + s);
    ctx.moveTo(nc.pos.x + s, nc.pos.y - s);
    ctx.lineTo(nc.pos.x - s, nc.pos.y + s);
    ctx.stroke();
  }

  private drawSymbol(sym: SchSymbol, selected: boolean) {
    const ctx = this.ctx;
    const color = selected ? COLORS.selected : COLORS.symbol;
    const libSym = sym.libSymbol;

    ctx.save();
    ctx.translate(sym.pos.x, sym.pos.y);

    if (sym.mirror === "x") ctx.scale(-1, 1);
    if (sym.mirror === "y") ctx.scale(1, -1);
    ctx.rotate((sym.rotation * Math.PI) / 180);

    if (libSym) {
      // Draw real symbol geometry
      const drawUnit = (unit: any) => {
        this.drawLibSymbolDrawings(ctx, unit, color);
        this.drawLibSymbolPins(ctx, unit, color, libSym);
      };

      // Draw unit 0 (common to all units)
      drawUnit(libSym);
      for (const child of libSym.children ?? []) {
        const u = child.unit ?? 0;
        if (u === 0 || u === sym.unit) drawUnit(child);
      }
    } else {
      // Fallback placeholder box
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.15;
      ctx.strokeRect(-2.54, -2.54, 5.08, 5.08);

      for (const pin of sym.pins) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pin.pos.x, pin.pos.y, 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Draw fields (reference, value) - not transformed by symbol rotation
    ctx.fillStyle = color;
    ctx.font = "1.27px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const field of sym.fields) {
      if (!field.visible) continue;
      const worldPos = sym.transformPoint(field.pos);
      ctx.fillText(field.text, worldPos.x, worldPos.y);
    }
  }

  private drawLibSymbolDrawings(ctx: CanvasRenderingContext2D, unit: any, color: string) {
    const DEFAULT_WIDTH = 0.1524;
    const BG_FILL = "#2a2a1e";

    for (const d of unit.drawings ?? []) {
      const strokeWidth = d.stroke?.width || DEFAULT_WIDTH;
      const fillType = d.fill?.type ?? "none";

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Rectangle
      if (d.start && d.end && !d.mid) {
        const x = Math.min(d.start.x, d.end.x);
        const y = Math.min(d.start.y, d.end.y);
        const w = Math.abs(d.end.x - d.start.x);
        const h = Math.abs(d.end.y - d.start.y);

        if (fillType === "background") {
          ctx.fillStyle = BG_FILL;
          ctx.fillRect(x, y, w, h);
        } else if (fillType === "outline") {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeRect(x, y, w, h);
        continue;
      }

      // Polyline
      if (d.pts && d.pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (let i = 1; i < d.pts.length; i++) {
          ctx.lineTo(d.pts[i].x, d.pts[i].y);
        }
        if (fillType === "background") {
          ctx.fillStyle = BG_FILL;
          ctx.fill();
        } else if (fillType === "outline") {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.stroke();
        continue;
      }

      // Circle
      if (d.center && d.radius != null) {
        ctx.beginPath();
        ctx.arc(d.center.x, d.center.y, d.radius, 0, Math.PI * 2);
        if (fillType === "background") {
          ctx.fillStyle = BG_FILL;
          ctx.fill();
        } else if (fillType === "outline") {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.stroke();
        continue;
      }

      // Arc (3-point: start, mid, end)
      if (d.start && d.mid && d.end) {
        const arc = this.computeArcFromThreePoints(d.start, d.mid, d.end);
        if (arc) {
          ctx.beginPath();
          ctx.arc(arc.cx, arc.cy, arc.r, arc.startAngle, arc.endAngle, arc.ccw);
          if (fillType === "background") {
            ctx.fillStyle = BG_FILL;
            ctx.fill();
          } else if (fillType === "outline") {
            ctx.fillStyle = color;
            ctx.fill();
          }
          ctx.stroke();
        }
        continue;
      }
    }
  }

  private drawLibSymbolPins(
    ctx: CanvasRenderingContext2D,
    unit: any,
    color: string,
    rootSym: any,
  ) {
    const hidePinNumbers = rootSym.pin_numbers?.hide ?? false;
    const hidePinNames = rootSym.pin_names?.hide ?? false;
    const pinNameOffset = rootSym.pin_names?.offset ?? 0.508;

    for (const pin of unit.pins ?? []) {
      if (pin.hide) continue;
      if (!pin.at) continue;

      const px = pin.at.position.x;
      const py = pin.at.position.y;
      const rot = pin.at.rotation ?? 0;
      const len = pin.length ?? 2.54;

      // Pin direction: rotation 0 = right, 90 = up, 180 = left, 270 = down
      const rad = (rot * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = -Math.sin(rad);

      // Draw pin line
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.1524;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + dx * len, py + dy * len);
      ctx.stroke();

      // Pin endpoint circle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Draw pin name (inside the symbol body, offset from pin end)
      if (!hidePinNames && pin.name?.text && pin.name.text !== "~") {
        ctx.save();
        ctx.translate(px + dx * len, py + dy * len);
        ctx.rotate(-rad);
        ctx.fillStyle = color;
        ctx.font = "1.0px sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(pin.name.text, pinNameOffset, 0);
        ctx.restore();
      }

      // Draw pin number (outside, along the pin line)
      if (!hidePinNumbers && pin.number?.text) {
        ctx.save();
        ctx.translate(px + dx * len * 0.5, py + dy * len * 0.5);
        ctx.rotate(-rad);
        ctx.fillStyle = color;
        ctx.font = "0.8px sans-serif";
        ctx.textBaseline = "bottom";
        ctx.textAlign = "center";
        ctx.fillText(pin.number.text, 0, -0.3);
        ctx.restore();
      }
    }
  }

  private computeArcFromThreePoints(
    start: { x: number; y: number },
    mid: { x: number; y: number },
    end: { x: number; y: number },
  ): { cx: number; cy: number; r: number; startAngle: number; endAngle: number; ccw: boolean } | null {
    // Find circumscribed circle center from 3 points
    const ax = start.x, ay = start.y;
    const bx = mid.x, by = mid.y;
    const cx = end.x, cy = end.y;

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;

    const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
    const startAngle = Math.atan2(ay - uy, ax - ux);
    const midAngle = Math.atan2(by - uy, bx - ux);
    const endAngle = Math.atan2(cy - uy, cx - ux);

    // Determine direction: check if mid is on the CCW arc from start to end
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const ccw = cross > 0;

    // Verify mid is between start and end on the chosen arc
    const normalizeAngle = (a: number) => (a + 2 * Math.PI) % (2 * Math.PI);
    const ns = normalizeAngle(startAngle);
    const nm = normalizeAngle(midAngle);
    const ne = normalizeAngle(endAngle);

    // Check if mid falls on the shorter arc; if not, flip direction
    let betweenCCW: boolean;
    if (ns <= ne) {
      betweenCCW = nm >= ns && nm <= ne;
    } else {
      betweenCCW = nm >= ns || nm <= ne;
    }

    const actualCCW = betweenCCW ? false : true;

    return { cx: ux, cy: uy, r, startAngle, endAngle, ccw: actualCCW };
  }

  private drawSheet(sheet: SchSheet, selected: boolean) {
    const ctx = this.ctx;
    const color = selected ? COLORS.selected : COLORS.sheet;

    ctx.strokeStyle = color;
    ctx.lineWidth = 0.2;
    ctx.strokeRect(sheet.pos.x, sheet.pos.y, sheet.size.x, sheet.size.y);

    ctx.fillStyle = color;
    ctx.font = "1.27px sans-serif";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(sheet.name, sheet.pos.x, sheet.pos.y - 0.5);

    ctx.font = "1px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = COLORS.label;
    ctx.fillText(sheet.fileName, sheet.pos.x, sheet.pos.y + sheet.size.y + 0.5);
  }

  drawCrosshair(pos: Vec2) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const s = this.worldToScreen(pos.x, pos.y);
    const len = 15;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#ffffff40";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(s.x - len, s.y);
    ctx.lineTo(s.x + len, s.y);
    ctx.moveTo(s.x, s.y - len);
    ctx.lineTo(s.x, s.y + len);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Calculate bounding box of all items in a doc */
  static getDocBounds(doc: SchematicDoc): BBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasItems = false;

    for (const item of doc.allItems()) {
      hasItems = true;
      const bb = item.getBBox();
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    }

    if (!hasItems) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}

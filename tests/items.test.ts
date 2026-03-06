import { describe, it, expect } from "vitest";
import {
  SchLine,
  SchJunction,
  SchLabel,
  SchNoConnect,
  SchSymbol,
  SchSheet,
} from "../src/editor/items";
import { vec2 } from "../src/editor/types";

describe("SchLine", () => {
  it("creates with start and end points", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 0), "wire");
    expect(line.start).toEqual({ x: 0, y: 0 });
    expect(line.end).toEqual({ x: 10, y: 0 });
    expect(line.layer).toBe("wire");
  });

  it("clones without sharing references", () => {
    const line = new SchLine(vec2(1, 2), vec2(3, 4), "wire");
    const clone = line.clone();
    clone.start.x = 99;
    expect(line.start.x).toBe(1);
  });

  it("computes bounding box", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 5));
    const bb = line.getBBox();
    expect(bb.x).toBe(0);
    expect(bb.y).toBe(0);
    expect(bb.width).toBe(10);
    expect(bb.height).toBe(5);
  });

  it("hit tests near the segment", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    expect(line.hitTest(vec2(5, 0), 0.5)).toBe(true);
    expect(line.hitTest(vec2(5, 0.3), 0.5)).toBe(true);
    expect(line.hitTest(vec2(5, 5), 0.5)).toBe(false);
  });

  it("detects null (zero-length) lines", () => {
    expect(new SchLine(vec2(1, 1), vec2(1, 1)).isNull()).toBe(true);
    expect(new SchLine(vec2(0, 0), vec2(1, 0)).isNull()).toBe(false);
  });

  it("moves by delta", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    line.move(vec2(5, 3));
    expect(line.start).toEqual({ x: 5, y: 3 });
    expect(line.end).toEqual({ x: 15, y: 3 });
  });

  it("rotates 90 degrees CW around origin", () => {
    const line = new SchLine(vec2(10, 0), vec2(10, 0));
    line.rotate(vec2(0, 0), false);
    expect(line.start.x).toBeCloseTo(0);
    expect(line.start.y).toBeCloseTo(10);
  });

  it("mirrors horizontally", () => {
    const line = new SchLine(vec2(2, 5), vec2(8, 5));
    line.mirrorH(5);
    expect(line.start.x).toBeCloseTo(8);
    expect(line.end.x).toBeCloseTo(2);
  });

  it("mirrors vertically", () => {
    const line = new SchLine(vec2(0, 2), vec2(0, 8));
    line.mirrorV(5);
    expect(line.start.y).toBeCloseTo(8);
    expect(line.end.y).toBeCloseTo(2);
  });

  it("returns connection points at endpoints", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    const pts = line.getConnectionPoints();
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1]).toEqual({ x: 10, y: 0 });
  });

  it("is connectable", () => {
    expect(new SchLine(vec2(0, 0), vec2(1, 0)).isConnectable()).toBe(true);
  });

  it("computes midpoint", () => {
    const line = new SchLine(vec2(0, 0), vec2(10, 4));
    expect(line.midPoint()).toEqual({ x: 5, y: 2 });
  });

  it("bus has wider stroke", () => {
    const wire = new SchLine(vec2(0, 0), vec2(1, 0), "wire");
    const bus = new SchLine(vec2(0, 0), vec2(1, 0), "bus");
    expect(bus.stroke.width).toBeGreaterThan(wire.stroke.width);
  });
});

describe("SchJunction", () => {
  it("creates at position", () => {
    const j = new SchJunction(vec2(5, 10));
    expect(j.pos).toEqual({ x: 5, y: 10 });
    expect(j.itemType).toBe("junction");
  });

  it("hit tests within diameter", () => {
    const j = new SchJunction(vec2(0, 0), 1.0);
    expect(j.hitTest(vec2(0, 0), 0)).toBe(true);
    expect(j.hitTest(vec2(0.4, 0), 0)).toBe(true);
    expect(j.hitTest(vec2(5, 5), 0)).toBe(false);
  });

  it("moves by delta", () => {
    const j = new SchJunction(vec2(1, 2));
    j.move(vec2(3, 4));
    expect(j.pos).toEqual({ x: 4, y: 6 });
  });

  it("clones independently", () => {
    const j = new SchJunction(vec2(1, 2));
    const c = j.clone();
    c.pos.x = 99;
    expect(j.pos.x).toBe(1);
  });
});

describe("SchLabel", () => {
  it("creates with text and position", () => {
    const l = new SchLabel(vec2(10, 20), "VCC");
    expect(l.text).toBe("VCC");
    expect(l.pos).toEqual({ x: 10, y: 20 });
    expect(l.labelType).toBe("label");
  });

  it("can be global label type", () => {
    const l = new SchLabel(vec2(0, 0), "GND", "global_label");
    expect(l.labelType).toBe("global_label");
  });

  it("hit tests within bounding box", () => {
    const l = new SchLabel(vec2(0, 0), "NET1");
    expect(l.hitTest(vec2(1, 0), 1)).toBe(true);
  });

  it("rotates and updates spin", () => {
    const l = new SchLabel(vec2(10, 0), "A");
    expect(l.spin).toBe(0); // LEFT
    l.rotate(vec2(0, 0), false); // CW
    expect(l.spin).toBe(1); // UP
  });

  it("clones independently", () => {
    const l = new SchLabel(vec2(1, 2), "NET");
    const c = l.clone();
    c.text = "CHANGED";
    expect(l.text).toBe("NET");
  });
});

describe("SchNoConnect", () => {
  it("creates at position", () => {
    const nc = new SchNoConnect(vec2(5, 5));
    expect(nc.pos).toEqual({ x: 5, y: 5 });
    expect(nc.itemType).toBe("no_connect");
  });

  it("is connectable", () => {
    expect(new SchNoConnect(vec2(0, 0)).isConnectable()).toBe(true);
  });
});

describe("SchSymbol", () => {
  it("creates with defaults", () => {
    const sym = new SchSymbol(vec2(10, 20), "Device:R");
    expect(sym.pos).toEqual({ x: 10, y: 20 });
    expect(sym.libId).toBe("Device:R");
    expect(sym.rotation).toBe(0);
    expect(sym.mirror).toBe("none");
  });

  it("has reference and value fields", () => {
    const sym = new SchSymbol(vec2(0, 0), "Device:R");
    expect(sym.reference).toBe("?");
    expect(sym.value).toBe("R");
  });

  it("allows setting reference", () => {
    const sym = new SchSymbol(vec2(0, 0), "Device:C");
    sym.reference = "C1";
    expect(sym.reference).toBe("C1");
  });

  it("rotates by 90 degrees", () => {
    const sym = new SchSymbol(vec2(10, 0), "Device:R");
    sym.rotate(vec2(0, 0), false); // CW
    expect(sym.rotation).toBe(90);
    expect(sym.pos.x).toBeCloseTo(0);
    expect(sym.pos.y).toBeCloseTo(10);
  });

  it("mirrors horizontally toggles mirror state", () => {
    const sym = new SchSymbol(vec2(10, 0), "Device:R");
    expect(sym.mirror).toBe("none");
    sym.mirrorH(5);
    expect(sym.mirror).toBe("x");
    expect(sym.pos.x).toBeCloseTo(0);
    sym.mirrorH(0);
    expect(sym.mirror).toBe("none");
  });

  it("transforms pin positions", () => {
    const sym = new SchSymbol(vec2(10, 20), "Device:R");
    sym.pins = [
      { number: "1", name: "A", pos: vec2(0, -5), type: "passive" },
      { number: "2", name: "B", pos: vec2(0, 5), type: "passive" },
    ];
    const pinPositions = sym.getPinPositions();
    expect(pinPositions[0]).toEqual({ x: 10, y: 15 });
    expect(pinPositions[1]).toEqual({ x: 10, y: 25 });
  });

  it("clones deeply", () => {
    const sym = new SchSymbol(vec2(1, 2), "Device:R");
    sym.fields[0]!.text = "R1";
    const c = sym.clone();
    c.fields[0]!.text = "R2";
    expect(sym.fields[0]!.text).toBe("R1");
  });
});

describe("SchSheet", () => {
  it("creates with position and size", () => {
    const sheet = new SchSheet(vec2(10, 20), vec2(30, 20), "Sub", "sub.kicad_sch");
    expect(sheet.pos).toEqual({ x: 10, y: 20 });
    expect(sheet.size).toEqual({ x: 30, y: 20 });
    expect(sheet.name).toBe("Sub");
  });

  it("computes bounding box from pos and size", () => {
    const sheet = new SchSheet(vec2(10, 20), vec2(30, 20), "S", "s.kicad_sch");
    const bb = sheet.getBBox();
    expect(bb).toEqual({ x: 10, y: 20, width: 30, height: 20 });
  });

  it("mirrors horizontally accounting for width", () => {
    const sheet = new SchSheet(vec2(10, 0), vec2(20, 10), "S", "s.kicad_sch");
    sheet.mirrorH(20);
    expect(sheet.pos.x).toBeCloseTo(10); // 2*20 - 10 - 20 = 10
  });
});

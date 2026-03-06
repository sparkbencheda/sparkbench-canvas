import { describe, it, expect } from "vitest";
import { SchematicDoc } from "../src/editor/schematic-doc";
import { SchLine, SchJunction, SchLabel, SchSymbol } from "../src/editor/items";
import { vec2 } from "../src/editor/types";

function makeDoc() {
  return new SchematicDoc("test.kicad_sch");
}

describe("SchematicDoc", () => {
  describe("item management", () => {
    it("starts empty", () => {
      const doc = makeDoc();
      expect(doc.itemCount()).toBe(0);
    });

    it("adds and retrieves items", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);
      expect(doc.getItem(line.id)).toBe(line);
      expect(doc.itemCount()).toBe(1);
    });

    it("removes items", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);
      doc.removeItem(line);
      expect(doc.getItem(line.id)).toBeUndefined();
      expect(doc.itemCount()).toBe(0);
    });
  });

  describe("typed queries", () => {
    it("iterates only wires", () => {
      const doc = makeDoc();
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0), "wire"));
      doc.addItem(new SchLine(vec2(0, 0), vec2(0, 10), "bus"));
      doc.addItem(new SchJunction(vec2(5, 5)));

      const wires = Array.from(doc.wires());
      expect(wires).toHaveLength(1);
      expect(wires[0]!.layer).toBe("wire");
    });

    it("iterates only buses", () => {
      const doc = makeDoc();
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0), "wire"));
      doc.addItem(new SchLine(vec2(0, 0), vec2(0, 10), "bus"));

      const buses = Array.from(doc.buses());
      expect(buses).toHaveLength(1);
      expect(buses[0]!.layer).toBe("bus");
    });

    it("iterates junctions", () => {
      const doc = makeDoc();
      doc.addItem(new SchJunction(vec2(5, 5)));
      doc.addItem(new SchJunction(vec2(10, 10)));
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));

      expect(Array.from(doc.junctions())).toHaveLength(2);
    });

    it("iterates labels", () => {
      const doc = makeDoc();
      doc.addItem(new SchLabel(vec2(0, 0), "VCC"));
      doc.addItem(new SchLabel(vec2(5, 5), "GND", "global_label"));
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));

      expect(Array.from(doc.labels())).toHaveLength(2);
    });

    it("iterates symbols", () => {
      const doc = makeDoc();
      doc.addItem(new SchSymbol(vec2(0, 0), "Device:R"));
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));

      expect(Array.from(doc.symbols())).toHaveLength(1);
    });
  });

  describe("spatial queries", () => {
    it("hit tests items at position", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      const hits = doc.hitTest(vec2(5, 0));
      expect(hits).toContain(line);
    });

    it("returns empty for misses", () => {
      const doc = makeDoc();
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));
      expect(doc.hitTest(vec2(50, 50))).toHaveLength(0);
    });

    it("finds items in area", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(2, 2), vec2(8, 2));
      doc.addItem(line);
      doc.addItem(new SchLine(vec2(20, 20), vec2(30, 20)));

      const results = doc.itemsInArea({ x: 0, y: 0, width: 10, height: 10 });
      expect(results).toHaveLength(1);
      expect(results).toContain(line);
    });
  });

  describe("connection queries", () => {
    it("finds connectable items at position", () => {
      const doc = makeDoc();
      const wire1 = new SchLine(vec2(0, 0), vec2(10, 0));
      const wire2 = new SchLine(vec2(10, 0), vec2(10, 10));
      doc.addItem(wire1);
      doc.addItem(wire2);

      const found = doc.findConnectableAt(vec2(10, 0));
      expect(found).toContain(wire1);
      expect(found).toContain(wire2);
    });

    it("excludes specified item", () => {
      const doc = makeDoc();
      const wire1 = new SchLine(vec2(0, 0), vec2(10, 0));
      const wire2 = new SchLine(vec2(10, 0), vec2(10, 10));
      doc.addItem(wire1);
      doc.addItem(wire2);

      const found = doc.findConnectableAt(vec2(10, 0), wire1);
      expect(found).not.toContain(wire1);
      expect(found).toContain(wire2);
    });

    it("detects junction needed at T-intersection", () => {
      const doc = makeDoc();
      // Three wires meeting at (10, 0)
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));
      doc.addItem(new SchLine(vec2(10, 0), vec2(20, 0)));
      doc.addItem(new SchLine(vec2(10, 0), vec2(10, 10)));

      expect(doc.needsJunction(vec2(10, 0))).toBe(true);
    });

    it("no junction needed for simple connection", () => {
      const doc = makeDoc();
      doc.addItem(new SchLine(vec2(0, 0), vec2(10, 0)));
      doc.addItem(new SchLine(vec2(10, 0), vec2(20, 0)));

      expect(doc.needsJunction(vec2(10, 0))).toBe(false);
    });

    it("detects existing junction", () => {
      const doc = makeDoc();
      doc.addItem(new SchJunction(vec2(10, 0)));

      expect(doc.hasJunctionAt(vec2(10, 0))).toBe(true);
      expect(doc.hasJunctionAt(vec2(99, 99))).toBe(false);
    });
  });

  describe("undo/redo integration", () => {
    it("commitAdd adds item and supports undo", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.commitAdd(line, "Add wire");

      expect(doc.itemCount()).toBe(1);

      doc.performUndo();
      expect(doc.itemCount()).toBe(0);

      doc.performRedo();
      expect(doc.itemCount()).toBe(1);
    });

    it("commitRemove removes item and supports undo", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);
      doc.commitRemove(line, "Delete wire");

      expect(doc.itemCount()).toBe(0);

      doc.performUndo();
      expect(doc.itemCount()).toBe(1);
    });

    it("commitModify preserves original state for undo", () => {
      const doc = makeDoc();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      doc.commitModify(line);
      line.start = vec2(5, 5);
      line.end = vec2(15, 5);
      doc.commitPush("Move wire");

      expect(line.start).toEqual({ x: 5, y: 5 });

      doc.performUndo();
      expect(line.start).toEqual({ x: 0, y: 0 });
      expect(line.end).toEqual({ x: 10, y: 0 });
    });

    it("multiple undo/redo cycles work correctly", () => {
      const doc = makeDoc();
      const j1 = new SchJunction(vec2(0, 0));
      const j2 = new SchJunction(vec2(5, 5));

      doc.commitAdd(j1, "Add J1");
      doc.commitAdd(j2, "Add J2");

      expect(doc.itemCount()).toBe(2);

      doc.performUndo(); // Undo J2
      expect(doc.itemCount()).toBe(1);

      doc.performUndo(); // Undo J1
      expect(doc.itemCount()).toBe(0);

      doc.performRedo(); // Redo J1
      expect(doc.itemCount()).toBe(1);

      doc.performRedo(); // Redo J2
      expect(doc.itemCount()).toBe(2);
    });
  });
});

import { describe, it, expect } from "vitest";
import { GridHelper, SnapMode } from "../src/editor/grid";
import { SchematicDoc } from "../src/editor/schematic-doc";
import { SchLine, SchJunction, SchSymbol } from "../src/editor/items";
import { vec2 } from "../src/editor/types";

describe("GridHelper", () => {
  describe("snapToGrid", () => {
    it("snaps to nearest grid point", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;

      const snapped = grid.snapToGrid(vec2(1.0, 2.0));
      expect(snapped.x).toBeCloseTo(1.27);
      expect(snapped.y).toBeCloseTo(2.54);
    });

    it("exact grid points stay unchanged", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;

      const snapped = grid.snapToGrid(vec2(2.54, 5.08));
      expect(snapped.x).toBeCloseTo(2.54);
      expect(snapped.y).toBeCloseTo(5.08);
    });

    it("returns input when grid disabled", () => {
      const grid = new GridHelper();
      grid.gridEnabled = false;

      const snapped = grid.snapToGrid(vec2(1.5, 2.5));
      expect(snapped.x).toBe(1.5);
      expect(snapped.y).toBe(2.5);
    });

    it("works with different grid sizes", () => {
      const grid = new GridHelper();
      grid.gridSize = 2.54;

      const snapped = grid.snapToGrid(vec2(3.0, 6.0));
      expect(snapped.x).toBeCloseTo(2.54);
      expect(snapped.y).toBeCloseTo(5.08);
    });

    it("handles negative coordinates", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;

      const snapped = grid.snapToGrid(vec2(-1.0, -2.0));
      expect(snapped.x).toBeCloseTo(-1.27);
      expect(snapped.y).toBeCloseTo(-2.54);
    });

    it("handles zero", () => {
      const grid = new GridHelper();
      const snapped = grid.snapToGrid(vec2(0, 0));
      expect(snapped.x).toBe(0);
      expect(snapped.y).toBe(0);
    });
  });

  describe("bestSnapAnchor", () => {
    it("falls back to grid when snap disabled", () => {
      const grid = new GridHelper();
      grid.snapEnabled = false;
      grid.gridSize = 1.27;

      const result = grid.bestSnapAnchor(vec2(1.0, 2.0), SnapMode.GRID_WIRES, null);
      expect(result.x).toBeCloseTo(1.27);
      expect(result.y).toBeCloseTo(2.54);
    });

    it("falls back to grid with GRID_ONLY mode", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      doc.addItem(new SchLine(vec2(1.5, 2.5), vec2(10, 0)));

      const result = grid.bestSnapAnchor(vec2(1.0, 2.0), SnapMode.GRID_ONLY, doc);
      expect(result.x).toBeCloseTo(1.27);
      expect(result.y).toBeCloseTo(2.54);
    });

    it("snaps to wire endpoint in GRID_WIRES mode", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      const wire = new SchLine(vec2(1.0, 1.0), vec2(5.0, 1.0));
      doc.addItem(wire);

      // Position near the wire start
      const result = grid.bestSnapAnchor(vec2(1.1, 1.1), SnapMode.GRID_WIRES, doc);
      expect(result.x).toBeCloseTo(1.0);
      expect(result.y).toBeCloseTo(1.0);
    });

    it("snaps to junction in GRID_WIRES mode", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      doc.addItem(new SchJunction(vec2(3.0, 3.0)));

      const result = grid.bestSnapAnchor(vec2(3.1, 3.1), SnapMode.GRID_WIRES, doc);
      expect(result.x).toBeCloseTo(3.0);
      expect(result.y).toBeCloseTo(3.0);
    });

    it("snaps to symbol origin in GRID_SYMBOLS mode", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      doc.addItem(new SchSymbol(vec2(7.0, 7.0), "Device:R"));

      const result = grid.bestSnapAnchor(vec2(7.2, 7.2), SnapMode.GRID_SYMBOLS, doc);
      expect(result.x).toBeCloseTo(7.0);
      expect(result.y).toBeCloseTo(7.0);
    });

    it("falls back to grid when no nearby snap targets", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      doc.addItem(new SchLine(vec2(100, 100), vec2(110, 100)));

      const result = grid.bestSnapAnchor(vec2(1.0, 1.0), SnapMode.GRID_WIRES, doc);
      // Should snap to grid, not the far-away wire
      expect(result.x).toBeCloseTo(1.27);
      expect(result.y).toBeCloseTo(1.27);
    });

    it("skips item by ID", () => {
      const grid = new GridHelper();
      grid.gridSize = 1.27;
      const doc = new SchematicDoc("test.kicad_sch");
      const wire = new SchLine(vec2(1.0, 1.0), vec2(5.0, 1.0));
      doc.addItem(wire);

      const result = grid.bestSnapAnchor(
        vec2(1.1, 1.1),
        SnapMode.GRID_WIRES,
        doc,
        wire.id,
      );
      // Should not snap to the skipped wire, falls back to grid
      expect(result.x).toBeCloseTo(1.27);
      expect(result.y).toBeCloseTo(1.27);
    });
  });
});

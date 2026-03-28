import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager, ToolType, type ToolEvent, type EditorCallback } from "../src/editor/tools";
import { KicadSchDoc } from "../src/editor/kicad-sch-doc";
import { KicadSch } from "../src/kicanvas/kicad/schematic";
import { Vec2 } from "../src/kicanvas/base/math";
import "../src/kicanvas/kicad/schematic-edit";

// Minimal KicadSch for testing (bypassing parser)
function makeEmptySch(): KicadSch {
  const sch = Object.create(KicadSch.prototype) as KicadSch;
  sch.version = 20231120;
  sch.uuid = "test-uuid";
  sch.filename = "test.kicad_sch";
  sch.wires = [];
  sch.buses = [];
  sch.bus_entries = [];
  sch.bus_aliases = [];
  sch.junctions = [];
  sch.net_labels = [];
  sch.global_labels = [];
  sch.hierarchical_labels = [];
  sch.symbols = new Map();
  sch.no_connects = [];
  sch.drawings = [];
  sch.rule_areas = [];
  sch.netclass_flags = [];
  sch.images = [];
  sch.sheets = [];
  sch.embedded_files = [];
  sch.embedded_fonts = false;
  return sch;
}

function makeCallbacks(): EditorCallback {
  return {
    requestRedraw: vi.fn(),
    requestRepaint: vi.fn(),
    requestSymbolChooser: vi.fn(async () => null),
    requestLabelText: vi.fn(async () => null),
    showStatus: vi.fn(),
    setCursor: vi.fn(),
    editProperties: vi.fn(),
  };
}

function makeToolManager() {
  const sch = makeEmptySch();
  const doc = new KicadSchDoc(sch);
  const cb = makeCallbacks();
  const tm = new ToolManager(doc, cb);
  return { sch, doc, cb, tm };
}

function clickEvent(pos: Vec2, opts: Partial<ToolEvent> = {}): ToolEvent {
  return { type: "mousedown", pos, rawPos: pos, ...opts };
}

function mouseupEvent(pos: Vec2): ToolEvent {
  return { type: "mouseup", pos, rawPos: pos };
}

function keyEvent(key: string, opts: Partial<ToolEvent> = {}): ToolEvent {
  return { type: "keydown", pos: new Vec2(0, 0), rawPos: new Vec2(0, 0), key, ...opts };
}

describe("ToolManager", () => {
  describe("tool switching", () => {
    it("starts with select tool", () => {
      const { tm } = makeToolManager();
      expect(tm.activeTool).toBe(ToolType.SELECT);
    });

    it("switches tools", () => {
      const { tm, cb } = makeToolManager();
      tm.setTool(ToolType.WIRE);
      expect(tm.activeTool).toBe(ToolType.WIRE);
      expect(cb.setCursor).toHaveBeenCalledWith("crosshair");
    });

    it("sets default cursor on select tool", () => {
      const { tm, cb } = makeToolManager();
      tm.setTool(ToolType.WIRE);
      tm.setTool(ToolType.SELECT);
      expect(cb.setCursor).toHaveBeenCalledWith("default");
    });
  });

  describe("keyboard shortcuts", () => {
    it("w switches to wire tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("w"));
      expect(tm.activeTool).toBe(ToolType.WIRE);
    });

    it("b switches to bus tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("b"));
      expect(tm.activeTool).toBe(ToolType.BUS);
    });

    it("a switches to symbol tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("a"));
      expect(tm.activeTool).toBe(ToolType.SYMBOL);
    });

    it("l switches to label tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("l"));
      expect(tm.activeTool).toBe(ToolType.LABEL);
    });

    it("j switches to junction tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("j"));
      expect(tm.activeTool).toBe(ToolType.JUNCTION);
    });

    it("q switches to no-connect tool", () => {
      const { tm } = makeToolManager();
      tm.handleEvent(keyEvent("q"));
      expect(tm.activeTool).toBe(ToolType.NO_CONNECT);
    });

    it("ctrl+z triggers undo", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.commitAdd(wire as any, "Add wire");

      tm.handleEvent(keyEvent("z", { ctrl: true }));
      expect(doc.itemCount()).toBe(0);
    });

    it("ctrl+shift+z triggers redo", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.commitAdd(wire as any, "Add wire");
      doc.performUndo();

      tm.handleEvent(keyEvent("z", { ctrl: true, shift: true }));
      expect(doc.itemCount()).toBe(1);
    });
  });

  describe("selection", () => {
    it("selects item on click via hits", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.addItem(wire as any);

      // Simulate hits from viewer
      tm.handleEvent(clickEvent(new Vec2(5, 0), { hits: [{ item: wire, bbox: {} as any }] }));
      expect(tm.selection.has(wire as any)).toBe(true);
    });

    it("clears selection on empty click", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.addItem(wire as any);

      tm.handleEvent(clickEvent(new Vec2(5, 0), { hits: [{ item: wire, bbox: {} as any }] }));
      expect(tm.selection.size).toBe(1);

      tm.handleEvent(clickEvent(new Vec2(50, 50), { hits: [] }));
      tm.handleEvent(mouseupEvent(new Vec2(50, 50)));
      expect(tm.selection.size).toBe(0);
    });

    it("delete key removes selected items", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.addItem(wire as any);

      tm.handleEvent(clickEvent(new Vec2(5, 0), { hits: [{ item: wire, bbox: {} as any }] }));
      tm.handleEvent(mouseupEvent(new Vec2(5, 0)));
      tm.handleEvent(keyEvent("Delete"));

      expect(doc.itemCount()).toBe(0);
      expect(tm.selection.size).toBe(0);
    });

    it("delete supports undo", () => {
      const { tm, doc } = makeToolManager();
      const wire = KicadSchDoc.createWire([new Vec2(0, 0), new Vec2(10, 0)]);
      doc.addItem(wire as any);

      tm.handleEvent(clickEvent(new Vec2(5, 0), { hits: [{ item: wire, bbox: {} as any }] }));
      tm.handleEvent(mouseupEvent(new Vec2(5, 0)));
      tm.handleEvent(keyEvent("Delete"));
      expect(doc.itemCount()).toBe(0);

      doc.performUndo();
      expect(doc.itemCount()).toBe(1);
    });
  });

  describe("junction placement", () => {
    it("places junction on click", () => {
      const { tm, doc } = makeToolManager();
      tm.setTool(ToolType.JUNCTION);
      tm.handleEvent(clickEvent(new Vec2(5, 5)));

      expect(doc.itemCount()).toBe(1);
      const junctions = Array.from(doc.junctions());
      expect(junctions).toHaveLength(1);
      expect(junctions[0]!.at.position.x).toBeCloseTo(5);
      expect(junctions[0]!.at.position.y).toBeCloseTo(5);
    });
  });

  describe("no-connect placement", () => {
    it("places no-connect on click", () => {
      const { tm, doc } = makeToolManager();
      tm.setTool(ToolType.NO_CONNECT);
      tm.handleEvent(clickEvent(new Vec2(3, 7)));

      expect(doc.itemCount()).toBe(1);
      const ncs = Array.from(doc.noConnects());
      expect(ncs).toHaveLength(1);
    });
  });

  describe("rotate and mirror", () => {
    it("rotates selected items", () => {
      const { tm, doc } = makeToolManager();
      const junction = KicadSchDoc.createJunction(new Vec2(10, 0));
      doc.addItem(junction as any);
      tm.selection.add(junction as any);

      tm.rotateSelection(new Vec2(0, 0));
      // Junction at (10,0) rotated 90° CW around origin → (0, 10)
      expect(junction.at.position.x).toBeCloseTo(0);
      expect(junction.at.position.y).toBeCloseTo(10);
    });

    it("mirrors selected items horizontally", () => {
      const { tm, doc } = makeToolManager();
      const junction = KicadSchDoc.createJunction(new Vec2(10, 0));
      doc.addItem(junction as any);
      tm.selection.add(junction as any);

      tm.mirrorSelectionH(new Vec2(5, 0));
      expect(junction.at.position.x).toBeCloseTo(0);
    });

    it("mirrors selected items vertically", () => {
      const { tm, doc } = makeToolManager();
      const junction = KicadSchDoc.createJunction(new Vec2(0, 10));
      doc.addItem(junction as any);
      tm.selection.add(junction as any);

      tm.mirrorSelectionV(new Vec2(0, 5));
      expect(junction.at.position.y).toBeCloseTo(0);
    });

    it("rotate supports undo", () => {
      const { tm, doc } = makeToolManager();
      const junction = KicadSchDoc.createJunction(new Vec2(10, 0));
      doc.addItem(junction as any);
      tm.selection.add(junction as any);

      tm.rotateSelection(new Vec2(0, 0));
      expect(junction.at.position.x).toBeCloseTo(0);

      doc.performUndo();
      expect(junction.at.position.x).toBeCloseTo(10);
      expect(junction.at.position.y).toBeCloseTo(0);
    });
  });
});

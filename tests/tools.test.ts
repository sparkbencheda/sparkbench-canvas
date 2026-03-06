import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager, ToolType, type ToolEvent, type EditorCallback } from "../src/editor/tools";
import { SchematicDoc } from "../src/editor/schematic-doc";
import { SchLine, SchJunction, SchSymbol } from "../src/editor/items";
import { vec2 } from "../src/editor/types";

function makeCallbacks(): EditorCallback {
  return {
    requestRedraw: vi.fn(),
    requestSymbolChooser: vi.fn(async () => null),
    requestLabelText: vi.fn(async () => null),
    showStatus: vi.fn(),
    setCursor: vi.fn(),
  };
}

function makeToolManager() {
  const doc = new SchematicDoc("test.kicad_sch");
  const cb = makeCallbacks();
  const tm = new ToolManager(doc, cb);
  return { doc, cb, tm };
}

function clickEvent(pos: { x: number; y: number }, opts: Partial<ToolEvent> = {}): ToolEvent {
  return { type: "mousedown", pos, rawPos: pos, ...opts };
}

function motionEvent(pos: { x: number; y: number }): ToolEvent {
  return { type: "motion", pos, rawPos: pos };
}

function mouseupEvent(pos: { x: number; y: number }): ToolEvent {
  return { type: "mouseup", pos, rawPos: pos };
}

function keyEvent(key: string, opts: Partial<ToolEvent> = {}): ToolEvent {
  return { type: "keydown", pos: vec2(0, 0), rawPos: vec2(0, 0), key, ...opts };
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
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.commitAdd(line, "Add wire");

      tm.handleEvent(keyEvent("z", { ctrl: true }));
      expect(doc.itemCount()).toBe(0);
    });

    it("ctrl+shift+z triggers redo", () => {
      const { tm, doc } = makeToolManager();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.commitAdd(line, "Add wire");
      doc.performUndo();

      tm.handleEvent(keyEvent("z", { ctrl: true, shift: true }));
      expect(doc.itemCount()).toBe(1);
    });
  });

  describe("selection", () => {
    it("selects item on click", () => {
      const { tm, doc } = makeToolManager();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      tm.handleEvent(clickEvent(vec2(5, 0)));
      expect(tm.selection.has(line.id)).toBe(true);
    });

    it("clears selection on empty click", () => {
      const { tm, doc } = makeToolManager();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      tm.handleEvent(clickEvent(vec2(5, 0)));
      expect(tm.selection.size).toBe(1);

      tm.handleEvent(clickEvent(vec2(50, 50)));
      tm.handleEvent(mouseupEvent(vec2(50, 50)));
      expect(tm.selection.size).toBe(0);
    });

    it("shift-click toggles selection", () => {
      const { tm, doc } = makeToolManager();
      const line1 = new SchLine(vec2(0, 0), vec2(10, 0));
      const line2 = new SchLine(vec2(0, 5), vec2(10, 5));
      doc.addItem(line1);
      doc.addItem(line2);

      tm.handleEvent(clickEvent(vec2(5, 0)));
      expect(tm.selection.size).toBe(1);

      tm.handleEvent(clickEvent(vec2(5, 5), { shift: true }));
      expect(tm.selection.size).toBe(2);

      tm.handleEvent(clickEvent(vec2(5, 0), { shift: true }));
      expect(tm.selection.size).toBe(1);
    });

    it("delete key removes selected items", () => {
      const { tm, doc } = makeToolManager();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      tm.handleEvent(clickEvent(vec2(5, 0)));
      tm.handleEvent(mouseupEvent(vec2(5, 0)));
      tm.handleEvent(keyEvent("Delete"));

      expect(doc.itemCount()).toBe(0);
      expect(tm.selection.size).toBe(0);
    });

    it("delete supports undo", () => {
      const { tm, doc } = makeToolManager();
      const line = new SchLine(vec2(0, 0), vec2(10, 0));
      doc.addItem(line);

      tm.handleEvent(clickEvent(vec2(5, 0)));
      tm.handleEvent(mouseupEvent(vec2(5, 0)));
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
      tm.handleEvent(clickEvent(vec2(5, 5)));

      expect(doc.itemCount()).toBe(1);
      const junctions = Array.from(doc.junctions());
      expect(junctions).toHaveLength(1);
      expect(junctions[0]!.pos).toEqual({ x: 5, y: 5 });
    });
  });

  describe("no-connect placement", () => {
    it("places no-connect on click", () => {
      const { tm, doc } = makeToolManager();
      tm.setTool(ToolType.NO_CONNECT);
      tm.handleEvent(clickEvent(vec2(3, 7)));

      expect(doc.itemCount()).toBe(1);
      const items = Array.from(doc.allItems());
      expect(items[0]!.itemType).toBe("no_connect");
    });
  });

  describe("rotate and mirror", () => {
    it("rotates selected items", () => {
      const { tm, doc } = makeToolManager();
      const sym = new SchSymbol(vec2(10, 0), "Device:R");
      doc.addItem(sym);
      tm.selection.add(sym.id);

      tm.rotateSelection(vec2(0, 0));
      expect(sym.rotation).toBe(90);
    });

    it("mirrors selected items horizontally", () => {
      const { tm, doc } = makeToolManager();
      const sym = new SchSymbol(vec2(10, 0), "Device:R");
      doc.addItem(sym);
      tm.selection.add(sym.id);

      tm.mirrorSelectionH(vec2(5, 0));
      expect(sym.pos.x).toBeCloseTo(0);
      expect(sym.mirror).toBe("x");
    });

    it("mirrors selected items vertically", () => {
      const { tm, doc } = makeToolManager();
      const sym = new SchSymbol(vec2(0, 10), "Device:R");
      doc.addItem(sym);
      tm.selection.add(sym.id);

      tm.mirrorSelectionV(vec2(0, 5));
      expect(sym.pos.y).toBeCloseTo(0);
      expect(sym.mirror).toBe("y");
    });

    it("rotate and mirror support undo", () => {
      const { tm, doc } = makeToolManager();
      const sym = new SchSymbol(vec2(10, 0), "Device:R");
      doc.addItem(sym);
      tm.selection.add(sym.id);

      tm.rotateSelection(vec2(0, 0));
      expect(sym.rotation).toBe(90);

      doc.performUndo();
      expect(sym.rotation).toBe(0);
      expect(sym.pos.x).toBeCloseTo(10);
      expect(sym.pos.y).toBeCloseTo(0);
    });
  });
});

// Test harness entry point - exposes editor internals on window for Playwright
import { KicadSchDoc } from "../../src/editor/kicad-sch-doc";
import { ToolManager, ToolType, type ToolEvent, type EditorCallback } from "../../src/editor/tools";
import { GridHelper } from "../../src/editor/grid";
import { KicadSch, Wire, Junction, NoConnect, NetLabel, GlobalLabel } from "../../src/kicanvas/kicad/schematic";
import { Vec2 } from "../../src/kicanvas/base/math";
import "../../src/kicanvas/kicad/schematic-edit";

declare global {
  interface Window {
    testHarness: TestHarness;
  }
}

// Create a minimal empty KicadSch (bypassing parser)
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

class TestHarness {
  sch: KicadSch;
  doc: KicadSchDoc;
  tools: ToolManager;
  canvas: HTMLCanvasElement;
  statusLog: string[] = [];
  cursorLog: string[] = [];
  redrawCount = 0;

  constructor() {
    this.canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
    this.canvas.width = 800;
    this.canvas.height = 600;

    this.sch = makeEmptySch();
    this.doc = new KicadSchDoc(this.sch);

    const callbacks: EditorCallback = {
      requestRedraw: () => {
        this.redrawCount++;
      },
      requestRepaint: () => {
        this.redrawCount++;
      },
      requestSymbolChooser: async () => {
        // Auto-return a test symbol for testing
        return "Device:R";
      },
      requestLabelText: async (current) => {
        return "TEST_NET";
      },
      showStatus: (msg) => {
        this.statusLog.push(msg);
        const el = document.getElementById("status");
        if (el) el.textContent = msg;
      },
      setCursor: (cursor) => {
        this.cursorLog.push(cursor);
        this.canvas.style.cursor = cursor;
      },
      editProperties: () => {},
    };

    this.tools = new ToolManager(this.doc, callbacks);
  }

  draw() {
    // No-op: unified renderer doesn't use EditorRenderer in standalone mode
    this.redrawCount++;
  }

  // Simulate mouse events in world coordinates
  clickAt(worldX: number, worldY: number, opts: { shift?: boolean; dbl?: boolean } = {}) {
    const pos = new Vec2(worldX, worldY);
    const snapped = this.tools.grid.snapToGrid(pos);
    const snappedVec = new Vec2(snapped.x, snapped.y);

    this.tools.handleEvent({
      type: "mousedown",
      pos: snappedVec,
      rawPos: pos,
      shift: opts.shift,
    });

    this.tools.handleEvent({
      type: "mouseup",
      pos: snappedVec,
      rawPos: pos,
      shift: opts.shift,
    });

    if (opts.dbl) {
      this.tools.handleEvent({
        type: "dblclick",
        pos: snappedVec,
        rawPos: pos,
      });
    }
  }

  moveTo(worldX: number, worldY: number) {
    const pos = new Vec2(worldX, worldY);
    const snapped = this.tools.grid.snapToGrid(pos);
    this.tools.handleEvent({
      type: "motion",
      pos: new Vec2(snapped.x, snapped.y),
      rawPos: pos,
    });
  }

  pressKey(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
    this.tools.handleEvent({
      type: "keydown",
      pos: new Vec2(0, 0),
      rawPos: new Vec2(0, 0),
      key,
      ctrl: opts.ctrl,
      shift: opts.shift,
    });
  }

  // Getters for test assertions
  getItemCount() { return this.doc.itemCount(); }
  getWireCount() { return Array.from(this.doc.wires()).length; }
  getJunctionCount() { return Array.from(this.doc.junctions()).length; }
  getLabelCount() { return Array.from(this.doc.labels()).length; }
  getSymbolCount() { return Array.from(this.doc.symbols()).length; }
  getSelectionSize() { return this.tools.selection.size; }
  getActiveTool() { return this.tools.activeTool; }
  getLastStatus() { return this.statusLog.at(-1) ?? ""; }

  getWires() {
    return Array.from(this.doc.wires()).map(w => ({
      id: w.uuid,
      startX: w.pts[0]?.x ?? 0,
      startY: w.pts[0]?.y ?? 0,
      endX: w.pts[w.pts.length - 1]?.x ?? 0,
      endY: w.pts[w.pts.length - 1]?.y ?? 0,
      isNull: w.pts.length >= 2 &&
        Math.abs(w.pts[0]!.x - w.pts[w.pts.length - 1]!.x) < 0.001 &&
        Math.abs(w.pts[0]!.y - w.pts[w.pts.length - 1]!.y) < 0.001,
    }));
  }

  getItems() {
    const items: { id: string; type: string }[] = [];
    for (const item of this.doc.allItems()) {
      const type = item instanceof Wire ? "wire"
        : item instanceof Junction ? "junction"
        : item instanceof NoConnect ? "no_connect"
        : item instanceof NetLabel ? "label"
        : item instanceof GlobalLabel ? "global_label"
        : "unknown";
      items.push({ id: (item as any).uuid ?? "", type });
    }
    return items;
  }

  reset() {
    this.sch = makeEmptySch();
    this.doc = new KicadSchDoc(this.sch);

    // Re-create tool manager with new doc
    const callbacks: EditorCallback = {
      requestRedraw: () => { this.redrawCount++; },
      requestRepaint: () => { this.redrawCount++; },
      requestSymbolChooser: async () => "Device:R",
      requestLabelText: async () => "TEST_NET",
      showStatus: (msg) => {
        this.statusLog.push(msg);
        const el = document.getElementById("status");
        if (el) el.textContent = msg;
      },
      setCursor: (cursor) => { this.cursorLog.push(cursor); },
      editProperties: () => {},
    };

    this.tools = new ToolManager(this.doc, callbacks);
    this.statusLog = [];
    this.cursorLog = [];
    this.redrawCount = 0;
  }
}

// Initialize on DOM ready
window.testHarness = new TestHarness();
document.getElementById("status")!.textContent = "ready";

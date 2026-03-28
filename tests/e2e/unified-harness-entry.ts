// Unified renderer test harness - loads a real .kicad_sch file through kicanvas pipeline
import { KicadSch, Wire, Junction, NoConnect, NetLabel, GlobalLabel, SchematicSymbol } from "../../src/kicanvas/kicad/schematic";
import { KicadSchDoc } from "../../src/editor/kicad-sch-doc";
import { ToolManager, ToolType, type EditorCallback } from "../../src/editor/tools";
import { Vec2 } from "../../src/kicanvas/base/math";
import "../../src/kicanvas/kicad/schematic-edit";

// Import test fixture as text
import testSchContent from "../fixtures/test-simple.kicad_sch";

declare global {
  interface Window {
    testHarness: UnifiedTestHarness;
  }
}

class UnifiedTestHarness {
  sch: KicadSch;
  doc: KicadSchDoc;
  tools: ToolManager;
  canvas: HTMLCanvasElement;
  statusLog: string[] = [];
  redrawCount = 0;
  loadError: string | null = null;

  constructor() {
    this.canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
    this.canvas.width = 800;
    this.canvas.height = 600;

    try {
      // Parse the test schematic through kicanvas
      this.sch = new KicadSch("test-simple.kicad_sch", testSchContent);
      this.doc = new KicadSchDoc(this.sch);
    } catch (err: any) {
      this.loadError = err.message || String(err);
      // Create empty fallback
      this.sch = Object.create(KicadSch.prototype);
      Object.assign(this.sch, {
        version: 0, uuid: "", filename: "",
        wires: [], buses: [], bus_entries: [], bus_aliases: [],
        junctions: [], net_labels: [], global_labels: [],
        hierarchical_labels: [], symbols: new Map(), no_connects: [],
        drawings: [], rule_areas: [], netclass_flags: [], images: [],
        sheets: [], embedded_files: [], embedded_fonts: false,
      });
      this.doc = new KicadSchDoc(this.sch);
    }

    const callbacks: EditorCallback = {
      requestRedraw: () => { this.redrawCount++; },
      requestRepaint: () => { this.redrawCount++; },
      requestSymbolChooser: async () => "Device:R",
      requestLabelText: async () => "TEST_NET",
      showStatus: (msg) => { this.statusLog.push(msg); },
      setCursor: () => {},
      editProperties: () => {},
    };

    this.tools = new ToolManager(this.doc, callbacks);
  }

  // Getters for test assertions
  getLoadError() { return this.loadError; }
  getItemCount() { return this.doc.itemCount(); }
  getWireCount() { return Array.from(this.doc.wires()).length; }
  getJunctionCount() { return Array.from(this.doc.junctions()).length; }
  getNoConnectCount() { return Array.from(this.doc.noConnects()).length; }
  getLabelCount() { return Array.from(this.doc.labels()).length; }
  getSymbolCount() { return Array.from(this.doc.symbols()).length; }
  getActiveTool() { return this.tools.activeTool; }
  getSelectionSize() { return this.tools.selection.size; }
  getLastStatus() { return this.statusLog.at(-1) ?? ""; }

  getSymbolReferences() {
    return Array.from(this.doc.symbols()).map(s => s.reference ?? "?");
  }

  getSymbolValues() {
    return Array.from(this.doc.symbols()).map(s => s.value ?? "");
  }

  // Simulate interactions
  clickAt(worldX: number, worldY: number, opts: { shift?: boolean; dbl?: boolean } = {}) {
    const pos = new Vec2(worldX, worldY);
    const snapped = this.tools.grid.snapToGrid(pos);
    const snappedVec = new Vec2(snapped.x, snapped.y);

    this.tools.handleEvent({
      type: "mousedown", pos: snappedVec, rawPos: pos, shift: opts.shift,
    });
    this.tools.handleEvent({
      type: "mouseup", pos: snappedVec, rawPos: pos, shift: opts.shift,
    });
    if (opts.dbl) {
      this.tools.handleEvent({
        type: "dblclick", pos: snappedVec, rawPos: pos,
      });
    }
  }

  moveTo(worldX: number, worldY: number) {
    const pos = new Vec2(worldX, worldY);
    const snapped = this.tools.grid.snapToGrid(pos);
    this.tools.handleEvent({
      type: "motion", pos: new Vec2(snapped.x, snapped.y), rawPos: pos,
    });
  }

  pressKey(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
    this.tools.handleEvent({
      type: "keydown", pos: new Vec2(0, 0), rawPos: new Vec2(0, 0),
      key, ctrl: opts.ctrl, shift: opts.shift,
    });
  }
}

window.testHarness = new UnifiedTestHarness();
const status = document.getElementById("status")!;
if (window.testHarness.loadError) {
  status.textContent = `error: ${window.testHarness.loadError}`;
} else {
  status.textContent = "ready";
}

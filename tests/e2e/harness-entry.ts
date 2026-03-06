// Test harness entry point - exposes editor internals on window for Playwright
import { SchematicDoc } from "../../src/editor/schematic-doc";
import { ToolManager, ToolType, type ToolEvent, type EditorCallback } from "../../src/editor/tools";
import { EditorRenderer, type ViewTransform } from "../../src/webview/editor-renderer";
import { GridHelper } from "../../src/editor/grid";
import { SchLine, SchJunction, SchLabel, SchSymbol, SchNoConnect } from "../../src/editor/items";
import { vec2 } from "../../src/editor/types";

declare global {
  interface Window {
    testHarness: TestHarness;
  }
}

class TestHarness {
  doc: SchematicDoc;
  tools: ToolManager;
  renderer: EditorRenderer;
  canvas: HTMLCanvasElement;
  statusLog: string[] = [];
  cursorLog: string[] = [];
  redrawCount = 0;

  constructor() {
    this.canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
    this.canvas.width = 800;
    this.canvas.height = 600;

    this.renderer = new EditorRenderer(this.canvas);
    this.renderer.setTransform({ offsetX: 400, offsetY: 300, scale: 40 });

    this.doc = new SchematicDoc("test.kicad_sch");

    const callbacks: EditorCallback = {
      requestRedraw: () => {
        this.redrawCount++;
        this.draw();
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
    };

    this.tools = new ToolManager(this.doc, callbacks);
    this.draw();
  }

  draw() {
    this.renderer.clear();
    this.renderer.drawGrid(this.tools.grid.gridSize);
    this.renderer.drawDoc(this.doc, this.tools.selection);
  }

  // Simulate mouse events in world coordinates
  clickAt(worldX: number, worldY: number, opts: { shift?: boolean; dbl?: boolean } = {}) {
    const snapped = this.tools.grid.snapToGrid(vec2(worldX, worldY));
    const raw = vec2(worldX, worldY);

    this.tools.handleEvent({
      type: "mousedown",
      pos: snapped,
      rawPos: raw,
      shift: opts.shift,
    });

    this.tools.handleEvent({
      type: "mouseup",
      pos: snapped,
      rawPos: raw,
      shift: opts.shift,
    });

    if (opts.dbl) {
      this.tools.handleEvent({
        type: "dblclick",
        pos: snapped,
        rawPos: raw,
      });
    }
  }

  moveTo(worldX: number, worldY: number) {
    const snapped = this.tools.grid.snapToGrid(vec2(worldX, worldY));
    this.tools.handleEvent({
      type: "motion",
      pos: snapped,
      rawPos: vec2(worldX, worldY),
    });
  }

  pressKey(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
    this.tools.handleEvent({
      type: "keydown",
      pos: vec2(0, 0),
      rawPos: vec2(0, 0),
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
      id: w.id,
      startX: w.start.x, startY: w.start.y,
      endX: w.end.x, endY: w.end.y,
      layer: w.layer,
      isNull: w.isNull(),
    }));
  }

  getItems() {
    return Array.from(this.doc.allItems()).map(item => ({
      id: item.id,
      type: item.itemType,
    }));
  }

  reset() {
    // Clear everything for a fresh test
    for (const item of Array.from(this.doc.allItems())) {
      this.doc.removeItem(item);
    }
    this.tools.selection.clear();
    this.tools.setTool(ToolType.SELECT);
    this.statusLog = [];
    this.cursorLog = [];
    this.redrawCount = 0;
    this.draw();
  }
}

// Initialize on DOM ready
window.testHarness = new TestHarness();
document.getElementById("status")!.textContent = "ready";

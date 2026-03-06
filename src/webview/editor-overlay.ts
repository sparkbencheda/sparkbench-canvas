// Editor overlay - connects the ToolManager to the webview canvas

import { SchematicDoc } from "../editor/schematic-doc";
import { ToolManager, ToolType, type ToolEvent } from "../editor/tools";
import { EditorRenderer, type ViewTransform } from "./editor-renderer";
import type { KicadSch } from "../../vendor-kicanvas/src/kicad";
import { importKicadSch } from "./sch-import";

export class EditorOverlay {
  readonly doc: SchematicDoc;
  readonly tools: ToolManager;
  readonly renderer: EditorRenderer;
  readonly canvas: HTMLCanvasElement;

  private cursorPos = { x: 0, y: 0 };
  private leftMouseDown = false;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private panStartOffset = { x: 0, y: 0 };
  private statusEl: HTMLElement | null = null;
  private animFrameId = 0;
  private needsRedraw = false;

  constructor(container: HTMLElement, statusEl?: HTMLElement, kicadSch?: KicadSch) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "auto";
    this.canvas.style.zIndex = "5";
    container.style.position = "relative";
    container.appendChild(this.canvas);

    this.statusEl = statusEl ?? null;
    this.renderer = new EditorRenderer(this.canvas);

    // Import existing schematic data if provided
    this.doc = kicadSch ? importKicadSch(kicadSch) : new SchematicDoc("editor");

    this.tools = new ToolManager(this.doc, {
      requestRedraw: () => this.requestRedraw(),
      requestSymbolChooser: () => this.promptSymbol(),
      requestLabelText: (current) => this.promptLabel(current),
      showStatus: (msg) => this.showStatus(msg),
      setCursor: (cursor) => { this.canvas.style.cursor = cursor; },
    });

    this.setupEvents();
    this.renderer.resize();
    this.zoomToFit();
    this.requestRedraw();
  }

  dispose() {
    cancelAnimationFrame(this.animFrameId);
    this.canvas.remove();
  }

  private setupEvents() {
    const c = this.canvas;

    const ro = new ResizeObserver(() => {
      this.renderer.resize();
      this.requestRedraw();
    });
    ro.observe(c.parentElement!);

    c.addEventListener("mousedown", (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        const t = this.renderer.getTransform();
        this.panStartOffset = { x: t.offsetX, y: t.offsetY };
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        this.leftMouseDown = true;
        const pos = this.cssToWorld(e);
        const snapped = this.tools.grid.snapToGrid(pos);
        this.dispatchToolEvent("mousedown", snapped, pos, e);
      }
    });

    c.addEventListener("mousemove", (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        const t = this.renderer.getTransform();
        t.offsetX = this.panStartOffset.x + dx;
        t.offsetY = this.panStartOffset.y + dy;
        this.renderer.setTransform(t);
        this.requestRedraw();
        return;
      }

      const pos = this.cssToWorld(e);
      const snapped = this.tools.grid.snapToGrid(pos);
      this.cursorPos = snapped;
      this.dispatchToolEvent("motion", snapped, pos, e);
    });

    c.addEventListener("mouseup", (e) => {
      if (this.isPanning && (e.button === 1 || e.altKey)) {
        this.isPanning = false;
        return;
      }

      if (e.button === 0 && this.leftMouseDown) {
        this.leftMouseDown = false;
        const pos = this.cssToWorld(e);
        const snapped = this.tools.grid.snapToGrid(pos);
        this.dispatchToolEvent("mouseup", snapped, pos, e);
      }
    });

    c.addEventListener("dblclick", (e) => {
      const pos = this.cssToWorld(e);
      const snapped = this.tools.grid.snapToGrid(pos);
      this.dispatchToolEvent("dblclick", snapped, pos, e);
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const t = this.renderer.getTransform();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;

      // Mouse position in CSS pixels relative to canvas
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const newScale = t.scale * factor;
      if (newScale < 0.5 || newScale > 200) return;

      // Zoom toward mouse position
      t.offsetX = mx - (mx - t.offsetX) * factor;
      t.offsetY = my - (my - t.offsetY) * factor;
      t.scale = newScale;
      this.renderer.setTransform(t);
      this.requestRedraw();
    }, { passive: false });

    c.addEventListener("keydown", (e) => {
      const pos = this.cursorPos;
      this.tools.handleEvent({
        type: "keydown",
        pos,
        rawPos: pos,
        key: e.key,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
      });

      if (["w", "b", "a", "l", "j", "q", "m", "/", " "].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
      if (e.key === "Escape") {
        e.preventDefault();
      }
    });

    c.tabIndex = 0;
    c.addEventListener("mouseenter", () => c.focus());
  }

  /** Convert mouse event to world coordinates (CSS pixels → world) */
  private cssToWorld(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return this.renderer.screenToWorld(cssX, cssY);
  }

  private dispatchToolEvent(
    type: "click" | "dblclick" | "mousedown" | "mouseup" | "motion",
    snapped: { x: number; y: number },
    raw: { x: number; y: number },
    e: MouseEvent,
  ) {
    this.tools.handleEvent({
      type,
      pos: snapped,
      rawPos: raw,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
    });
  }

  private requestRedraw() {
    if (this.needsRedraw) return;
    this.needsRedraw = true;
    this.animFrameId = requestAnimationFrame(() => {
      this.needsRedraw = false;
      this.draw();
    });
  }

  private draw() {
    this.renderer.clear();
    this.renderer.drawGrid(this.tools.grid.gridSize);
    this.renderer.drawDoc(this.doc, this.tools.selection);
    this.renderer.drawCrosshair(this.cursorPos);
  }

  private async promptSymbol(): Promise<string | null> {
    const libId = prompt("Enter symbol library ID (e.g., Device:R):");
    return libId || null;
  }

  private async promptLabel(current?: string): Promise<string | null> {
    const text = prompt("Enter label text:", current ?? "");
    return text || null;
  }

  private showStatus(msg: string) {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
    }
  }

  setTool(tool: ToolType) {
    this.tools.setTool(tool);
    this.canvas.focus();
  }

  zoomToFit() {
    const bounds = EditorRenderer.getDocBounds(this.doc);
    const w = this.renderer.width || 800;
    const h = this.renderer.height || 600;
    const margin = 20; // CSS pixels margin

    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      // Empty doc - center at origin
      this.renderer.setTransform({ offsetX: w / 2, offsetY: h / 2, scale: 4 });
      return;
    }

    const availW = w - margin * 2;
    const availH = h - margin * 2;
    const scaleX = availW / bounds.width;
    const scaleY = availH / bounds.height;
    const scale = Math.min(scaleX, scaleY);

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    this.renderer.setTransform({
      offsetX: w / 2 - centerX * scale,
      offsetY: h / 2 - centerY * scale,
      scale,
    });
    this.requestRedraw();
  }
}

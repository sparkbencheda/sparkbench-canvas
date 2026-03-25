/*
    Editable Schematic Viewer - extends kicanvas SchematicViewer with
    multi-selection, hover, tool overlay, and editing event hooks.
    Cleanroomed from KiCad 10 eeschema selection/interaction patterns.
*/

import { Vec2, BBox } from "../../base/math";
import { Color, Polyline, Polygon } from "../../graphics";
import type { SchematicTheme } from "../../kicad";
import { KicadSch } from "../../kicad/schematic";
import { ItemFlags, isEditable, initItemFlags } from "../../kicad/schematic-edit";
import { ViewLayer, LayerNames } from "./layers";
import { SchematicViewer } from "./viewer";

// ==================== Event types ====================

export interface EditEvent {
    type: "mousedown" | "mouseup" | "click" | "dblclick" | "motion" | "keydown";
    worldPos: Vec2;
    shift: boolean;
    ctrl: boolean;
    button: number;
    key?: string;
    /** Items under cursor from layer query */
    hits: Array<{ item: any; bbox: BBox }>;
}

export type EditEventHandler = (evt: EditEvent) => void;

// ==================== Tool overlay interface ====================

export interface ToolOverlayPainter {
    paintOverlay(viewer: EditableSchematicViewer): void;
}

// ==================== Editable Viewer ====================

export class EditableSchematicViewer extends SchematicViewer {
    /** Set of selected item references */
    readonly selectedItems: Set<any> = new Set();

    /** Currently hovered item */
    hoveredItem: any = null;

    /** Marquee selection rectangle in world coords, or null */
    marqueeRect: BBox | null = null;

    /** External event handler (tool manager) */
    onEditEvent: EditEventHandler | null = null;

    /** Tool overlay painter */
    toolOverlay: ToolOverlayPainter | null = null;

    /** Whether editing is enabled */
    editingEnabled = true;

    private _selectionLayer: ViewLayer | null = null;
    private _toolOverlayLayer: ViewLayer | null = null;
    private _needsOverlayRepaint = false;

    constructor(canvas: HTMLCanvasElement, interactive: boolean, theme: SchematicTheme) {
        super(canvas, interactive, theme);
    }

    override async load(src: any) {
        await super.load(src);
        // Initialize flags on all items
        if (this.schematic) {
            initItemFlags(this.schematic);
        }
    }

    override async setup() {
        await super.setup();
        this._setupEditEvents();
    }

    // ==================== Selection ====================

    selectItem(item: any, addToSelection = false) {
        if (!addToSelection) {
            this.clearSelection();
        }
        if (item && isEditable(item)) {
            item.flags |= ItemFlags.SELECTED;
            this.selectedItems.add(item);
        }
        this._repaintOverlay();
    }

    deselectItem(item: any) {
        if (item && isEditable(item)) {
            item.flags &= ~ItemFlags.SELECTED;
            this.selectedItems.delete(item);
        }
        this._repaintOverlay();
    }

    toggleSelection(item: any) {
        if (this.selectedItems.has(item)) {
            this.deselectItem(item);
        } else {
            this.selectItem(item, true);
        }
    }

    clearSelection() {
        for (const item of this.selectedItems) {
            if (isEditable(item)) {
                item.flags &= ~ItemFlags.SELECTED;
            }
        }
        this.selectedItems.clear();
        this._repaintOverlay();
    }

    selectItemsInArea(bbox: BBox, addToSelection = false) {
        if (!addToSelection) {
            this.clearSelection();
        }
        // Query all interactive layers for items overlapping the bbox
        for (const layer of this.layers.interactive_layers()) {
            for (const [item, itemBBox] of layer.bboxes) {
                if (itemBBox.intersects(bbox)) {
                    if (isEditable(item)) {
                        item.flags |= ItemFlags.SELECTED;
                        this.selectedItems.add(item);
                    }
                }
            }
        }
        this._repaintOverlay();
    }

    // ==================== Hover ====================

    setHovered(item: any) {
        if (item === this.hoveredItem) return;
        if (this.hoveredItem && isEditable(this.hoveredItem)) {
            this.hoveredItem.flags &= ~ItemFlags.BRIGHTENED;
        }
        this.hoveredItem = item;
        if (item && isEditable(item)) {
            item.flags |= ItemFlags.BRIGHTENED;
        }
        this._repaintOverlay();
    }

    // ==================== Hit testing ====================

    queryItemsAt(worldPos: Vec2): Array<{ item: any; bbox: BBox }> {
        const results: Array<{ item: any; bbox: BBox }> = [];
        for (const layer of this.layers.interactive_layers()) {
            for (const [item, bbox] of layer.bboxes) {
                if (bbox.contains_point(worldPos)) {
                    results.push({ item, bbox });
                }
            }
        }
        return results;
    }

    // ==================== Overlay painting ====================

    private _repaintOverlay() {
        if (this._needsOverlayRepaint) return;
        this._needsOverlayRepaint = true;
        requestAnimationFrame(() => {
            this._needsOverlayRepaint = false;
            this._paintSelectionOverlay();
            this._paintToolOverlay();
            this.draw();
        });
    }

    requestOverlayRepaint() {
        this._repaintOverlay();
    }

    private _paintSelectionOverlay() {
        const overlay = this.layers.overlay;
        overlay.clear();

        this.renderer.start_layer(overlay.name);

        // Draw selection highlights
        const selColor = new Color(0, 0.67, 1, 0.8); // #00aaff
        const selFillColor = new Color(0, 0.67, 1, 0.1);

        for (const item of this.selectedItems) {
            // Find item's bbox from layers
            for (const layer of this.layers.interactive_layers()) {
                const bbox = layer.bboxes.get(item);
                if (bbox) {
                    const bb = bbox.copy().grow(0.5);
                    this.renderer.line(Polyline.from_BBox(bb, 0.15, selColor));
                    this.renderer.polygon(Polygon.from_BBox(bb, selFillColor));
                    break;
                }
            }
        }

        // Draw hover highlight
        if (this.hoveredItem && !this.selectedItems.has(this.hoveredItem)) {
            const hoverColor = new Color(1, 1, 1, 0.3);
            for (const layer of this.layers.interactive_layers()) {
                const bbox = layer.bboxes.get(this.hoveredItem);
                if (bbox) {
                    const bb = bbox.copy().grow(0.3);
                    this.renderer.line(Polyline.from_BBox(bb, 0.1, hoverColor));
                    break;
                }
            }
        }

        // Draw marquee selection rectangle
        if (this.marqueeRect) {
            const marqColor = new Color(0, 0.67, 1, 0.6);
            const marqFill = new Color(0, 0.67, 1, 0.08);
            this.renderer.line(Polyline.from_BBox(this.marqueeRect, 0.1, marqColor));
            this.renderer.polygon(Polygon.from_BBox(this.marqueeRect, marqFill));
        }

        overlay.graphics = this.renderer.end_layer();
        overlay.graphics.composite_operation = "source-over";
    }

    private _paintToolOverlay() {
        if (this.toolOverlay) {
            this.toolOverlay.paintOverlay(this);
        }
    }

    // ==================== Event setup ====================

    private _setupEditEvents() {
        if (!this.editingEnabled) return;

        const canvas = this.canvas;
        canvas.tabIndex = 0;

        const worldPos = (e: MouseEvent): Vec2 => {
            const rect = canvas.getBoundingClientRect();
            return this.viewport.camera.screen_to_world(
                new Vec2(e.clientX - rect.left, e.clientY - rect.top),
            );
        };

        const makeEvent = (type: EditEvent["type"], e: MouseEvent | KeyboardEvent, pos?: Vec2): EditEvent => {
            const wp = pos ?? (e instanceof MouseEvent ? worldPos(e) : this.mouse_position.copy());
            return {
                type,
                worldPos: wp,
                shift: e.shiftKey,
                ctrl: e.ctrlKey || e.metaKey,
                button: e instanceof MouseEvent ? e.button : 0,
                key: e instanceof KeyboardEvent ? e.key : undefined,
                hits: this.queryItemsAt(wp),
            };
        };

        // Mouse events — don't interfere with pan/zoom (middle click, alt+click)
        canvas.addEventListener("mousedown", (e) => {
            if (e.button === 1 || (e.button === 0 && e.altKey)) return; // pan
            if (e.button === 0 && this.onEditEvent) {
                this.onEditEvent(makeEvent("mousedown", e));
            }
        });

        canvas.addEventListener("mouseup", (e) => {
            if (e.button === 0 && this.onEditEvent) {
                this.onEditEvent(makeEvent("mouseup", e));
            }
        });

        canvas.addEventListener("click", (e) => {
            if (e.altKey) return;
            if (this.onEditEvent) {
                this.onEditEvent(makeEvent("click", e));
            }
        });

        canvas.addEventListener("dblclick", (e) => {
            if (this.onEditEvent) {
                this.onEditEvent(makeEvent("dblclick", e));
            }
        });

        canvas.addEventListener("mousemove", (e) => {
            if (this.onEditEvent) {
                const pos = worldPos(e);
                this.onEditEvent(makeEvent("motion", e, pos));
            }
        });

        canvas.addEventListener("keydown", (e) => {
            if (this.onEditEvent) {
                this.onEditEvent(makeEvent("keydown", e));
                // Prevent default for tool keys
                if (["w", "b", "a", "l", "j", "q", "m", "r", "x", "y", "Escape", "Delete", "Backspace"].includes(e.key)) {
                    e.preventDefault();
                }
                if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                }
            }
        });

        canvas.addEventListener("mouseenter", () => canvas.focus());
    }

    // ==================== Repaint after mutations ====================

    /**
     * Full repaint — call after item mutations (move, add, delete).
     * Re-executes all painters to rebuild layer graphics.
     */
    repaintAll() {
        // Preserve selection state
        const selected = new Set(this.selectedItems);

        this.paint();
        this.draw();

        // Re-apply selection flags
        for (const item of selected) {
            if (isEditable(item)) {
                item.flags |= ItemFlags.SELECTED;
            }
        }
        this._repaintOverlay();
    }

    // ==================== Override pick to not interfere ====================

    protected override on_pick(mouse: Vec2, items: any) {
        // Don't use kicanvas default single-item select — we handle it in onEditEvent
        if (this.editingEnabled) return;
        super.on_pick(mouse, items);
    }
}

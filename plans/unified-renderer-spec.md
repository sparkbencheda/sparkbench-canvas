# Unified Renderer Architecture Spec

Rewrite sparkbench-canvas to use a single rendering pipeline for both viewing and editing, replacing the current dual-renderer approach. Reference: KiCad 10 eeschema/pcbnew C++ source + kicanvas TypeScript viewer.

---

## Problem

Today there are two completely separate rendering paths:

1. **kicanvas viewer** (WebGL/Canvas2D) — high-quality read-only display with proper painters, layers, spatial queries, and selection highlighting. Cannot edit.
2. **EditorRenderer** (Canvas2D) — crude editing overlay with inline draw methods, no layers, no spatial index, hardcoded colors. Can edit but looks bad.

Switching between "view mode" and "edit mode" swaps canvases. Items render differently in each. Data must be imported/exported between models.

## Goal

One renderer. Always-on editing. No mode switch. The kicanvas rendering pipeline handles all display. Our `SchematicDoc` model handles all mutations. Tools interact directly with the unified view.

---

## Architecture Overview

```
User Input (mouse/keyboard)
    |
    v
ToolManager.processEvent(event)
    |
    v
Active Tool (SelectTool, WireTool, etc.)
    |
    v
Mutates SchematicDoc items via Commit
    |
    v
Commit.push() -> UndoStack + notify View
    |
    v
View marks dirty items -> Painter repaints affected layers
    |
    v
Renderer (Canvas2D or WebGL2) draws to screen
```

### Key Principle: Reuse kicanvas for rendering, KiCad patterns for editing

| Component | Source | Notes |
|-----------|--------|-------|
| Renderer API | kicanvas `Renderer` abstract class | Already supports Canvas2D + WebGL2 |
| Layer system | kicanvas `ViewLayerSet` | Already has spatial queries via bboxes |
| Painters | kicanvas schematic/board painters | Already draw every item type correctly |
| Camera/viewport | kicanvas `Viewport` + `Camera2` | Already handles pan/zoom/DPI |
| Item model | Our `SchematicDoc` + `SchItem` hierarchy | Already supports mutation + undo |
| Tool system | Our `ToolManager` + tools | Already works, needs state machine upgrade |
| Undo/redo | Our `UndoStack` | Already works, needs view notification |

---

## Phase 1: Unified View Layer

### 1.1 Make kicanvas painters work with mutable items

**Current:** kicanvas painters read from parsed KiCad data structures (immutable).
**Target:** Painters read from `SchematicDoc` items (mutable).

**Approach:** Create adapter painters that wrap our `SchItem` types and delegate to kicanvas painter primitives.

```typescript
// New: src/editor/painters/sch-item-painter.ts
class SchItemPainter {
  constructor(private gfx: Renderer, private settings: SchRenderSettings) {}

  paint(layer: ViewLayer, item: SchItem) {
    if (item instanceof SchLine) this.paintWire(layer, item);
    else if (item instanceof SchSymbol) this.paintSymbol(layer, item);
    else if (item instanceof SchLabel) this.paintLabel(layer, item);
    // ...
  }

  private paintWire(layer: ViewLayer, wire: SchLine) {
    // Uses same drawing logic as kicanvas WirePainter
    // but reads from SchLine.start/end instead of parsed KicadSch wire
    this.gfx.state.stroke = this.settings.wireColor;
    this.gfx.state.stroke_width = wire.stroke.width;
    this.gfx.line([wire.start, wire.end]);
  }
}
```

**Key files to port from kicanvas:**
- `vendor-kicanvas/src/viewers/schematic/painters/symbol.ts` (256 lines)
- `vendor-kicanvas/src/viewers/schematic/painters/pin.ts` (612 lines)
- `vendor-kicanvas/src/viewers/schematic/painters/label.ts` (498 lines)
- `vendor-kicanvas/src/viewers/schematic/painter.ts` (673 lines)

**Key files to reference from KiCad:**
- `vendor-kicad/kicad-10.0.0-rc2/eeschema/sch_painter.cpp` — definitive drawing logic for every item

### 1.2 Create SchRenderSettings

Replace hardcoded colors with a settings object (mirrors KiCad's `SCH_RENDER_SETTINGS`).

```typescript
// New: src/editor/render-settings.ts
interface SchRenderSettings {
  // Layer colors
  wireColor: Color;
  busColor: Color;
  junctionColor: Color;
  labelColor: Color;
  globalLabelColor: Color;
  symbolColor: Color;
  sheetColor: Color;
  noConnectColor: Color;
  backgroundColor: Color;
  gridColor: Color;
  selectionColor: Color;

  // Visibility
  showHiddenPins: boolean;
  showHiddenFields: boolean;
  showPinNumbers: boolean;
  showPinNames: boolean;
  showConnectionPoints: boolean;

  // Sizing
  defaultLineWidth: number;
  labelSizeRatio: number;
  pinSymbolSize: number;

  // Selection/highlighting
  highlightFactor: number;
  selectFactor: number;
}
```

### 1.3 Adapt kicanvas layer system

Use kicanvas `ViewLayerSet` directly but populate from `SchematicDoc` items.

**Schematic layers (from kicanvas, matching KiCad):**
```
interactive        — bbox hit testing (invisible)
marks              — DNP X marks
symbol_field       — reference, value text
label              — net/global/hier labels
junction           — junctions, no-connects
wire               — wires and buses
symbol_foreground  — symbol outlines, pin text
notes              — free text, shapes
symbol_pin         — pin lines
symbol_background  — symbol body fill
drawing_sheet      — border/title block
grid               — grid
selection_overlay  — selection highlights (NEW)
tool_overlay       — tool previews: ghost wires, marquee rect (NEW)
```

### 1.4 Repaint on mutation

When `Commit.push()` fires:
1. Identify changed items from the commit
2. For each changed item, find which layers it appears on
3. Mark those layers dirty
4. On next frame: repaint only dirty layers

**Optimization:** For small edits (move 1 item), only 2-3 layers need repainting. For bulk operations, repaint all.

```typescript
// In unified view
onCommitPush(commit: Commit) {
  for (const change of commit.changes) {
    const layers = this.layersFor(change.item);
    for (const layer of layers) layer.markDirty();
  }
  this.requestRedraw();
}
```

---

## Phase 2: Selection & Interaction via kicanvas View

### 2.1 Selection highlighting

kicanvas already has:
- `ViewLayer.query_point(pos)` — spatial lookup via bbox map
- Overlay layer that renders on top
- `paint_selected()` — draws selection rectangle

**Wire it up:**

```typescript
// In unified view
onMouseDown(worldPos: Vec2) {
  const hits = this.layers.query_point(worldPos);
  // hits is array of {item, bbox} from interactive layer
  this.toolManager.handleEvent({
    type: "mousedown",
    pos: snap(worldPos),
    rawPos: worldPos,
    hits, // pass hit results directly
  });
}
```

### 2.2 Hover highlighting

On mousemove, query the view for items under cursor. Set `BRIGHTENED` flag on hovered item, clear from previous. Redraw overlay layer only.

```typescript
onMouseMove(worldPos: Vec2) {
  const hits = this.layers.query_point(worldPos);
  const topHit = pickBest(hits);

  if (topHit !== this.hoveredItem) {
    if (this.hoveredItem) this.hoveredItem.flags &= ~BRIGHTENED;
    if (topHit) topHit.flags |= BRIGHTENED;
    this.hoveredItem = topHit;
    this.overlayLayer.markDirty();
  }
}
```

### 2.3 Remove EditorOverlay + EditorRenderer

Once the unified view handles:
- Rendering all items via kicanvas painters
- Selection highlighting via overlay layer
- Tool interaction via tool_overlay layer
- Hit testing via layer bbox queries

...delete:
- `src/webview/editor-overlay.ts`
- `src/webview/editor-renderer.ts`
- The "Edit" mode toggle button
- The dual-canvas approach

---

## Phase 3: Tool System Upgrade

### 3.1 Tool overlay layer

Tools that need visual feedback (wire preview, marquee rect, symbol ghost) draw to a dedicated `tool_overlay` layer that's repainted every frame during active tool use.

```typescript
// WireTool draws preview segments
paintOverlay(gfx: Renderer) {
  if (this.wireSegments.length === 0) return;
  gfx.state.stroke = settings.wireColor;
  gfx.state.stroke_width = 0.15;
  for (const seg of this.wireSegments) {
    gfx.line([seg.start, seg.end]);
  }
}
```

### 3.2 Cursor feedback

Tools set cursor via CSS on the canvas element (already working). Add:
- Snap indicator (small circle at snap point)
- Connection indicator (filled dot when hovering a connectable point)

### 3.3 Property editing

Keep the modal dialog approach from `editProperties()` — it works fine. No need to change.

---

## Phase 4: Board Editor Support

The same architecture works for PCB because kicanvas already has:
- `BoardPainter` with 31 item painters
- Board layer system (copper + technical + virtual layers)
- Board viewport

**For PCB editing, add:**
- `BoardDoc` — mutable board model (mirrors `SchematicDoc`)
- Board item types: `PcbTrack`, `PcbVia`, `PcbPad`, `PcbFootprint`, etc.
- Board-specific tools: routing, pad editing, zone fill
- `BoardItemPainter` — adapter from `BoardDoc` items to kicanvas board painters

The tool system (`ToolManager`, `BaseTool`, `Commit`, `UndoStack`) is shared between both editors — exactly like KiCad.

---

## Implementation Plan

### Step 1: SchRenderSettings + remove hardcoded colors
- Create `src/editor/render-settings.ts`
- Default theme matching KiCad dark mode
- Update all rendering code to read from settings

### Step 2: Adapter painters for SchematicDoc items
- Port kicanvas painter logic into `src/editor/painters/`
- One file per item type, reading from `SchItem` types
- Use kicanvas `Renderer` API (circle, line, polygon, arc)

### Step 3: Unified view class
- Create `src/editor/unified-view.ts`
- Wraps kicanvas `Renderer` + `ViewLayerSet` + `Viewport`
- Populates layers from `SchematicDoc`
- Handles camera, mouse events, hit testing

### Step 4: Wire selection/hover to unified view
- Selection highlighting via overlay layer
- Hover feedback via brightened flag
- Remove EditorRenderer hit testing (use layer queries)

### Step 5: Tool overlay rendering
- Each tool gets optional `paintOverlay(gfx)` method
- Unified view calls this on the tool_overlay layer each frame
- Wire preview, marquee rect, ghost symbols drawn here

### Step 6: Remove dual-renderer
- Delete EditorOverlay, EditorRenderer
- Remove "Edit" mode toggle
- Always-on editing when a `.kicad_sch` file is open
- Single canvas, single renderer

### Step 7: Board editing foundation
- Create `BoardDoc` with mutable board items
- Adapter painters for board items
- Board-specific tools

---

## File Map

### New files
```
src/editor/render-settings.ts      — SchRenderSettings interface + defaults
src/editor/unified-view.ts         — Single view combining renderer + layers + tools
src/editor/painters/
  wire-painter.ts                  — Wire/bus rendering
  symbol-painter.ts                — Symbol + fields rendering
  pin-painter.ts                   — Pin rendering (shapes, labels)
  label-painter.ts                 — All label types (local, global, hier)
  junction-painter.ts              — Junction + no-connect rendering
  sheet-painter.ts                 — Sheet rendering
  shape-painter.ts                 — Shapes (rect, circle, arc, poly)
  overlay-painter.ts               — Selection highlights, tool previews
```

### Files to delete (after migration)
```
src/webview/editor-overlay.ts      — Replaced by unified-view
src/webview/editor-renderer.ts     — Replaced by kicanvas renderer + painters
```

### Files to modify
```
src/webview/main.ts                — Remove edit mode toggle, use unified view
src/editor/tools.ts                — Add paintOverlay() to tool interface
src/editor/tools/select-tool.ts    — Use layer queries instead of doc.hitTest
src/editor/tools/wire-tool.ts      — Add paintOverlay() for wire preview
src/editor/schematic-doc.ts        — Add commit notification for view updates
src/extension.ts                   — Remove edit mode UI, simplify toolbar
```

### Reused from kicanvas (vendor, read-only)
```
vendor-kicanvas/src/graphics/renderer.ts        — Renderer API
vendor-kicanvas/src/graphics/canvas2d.ts         — Canvas2D backend
vendor-kicanvas/src/graphics/webgl/              — WebGL2 backend
vendor-kicanvas/src/viewers/base/view-layers.ts  — Layer system
vendor-kicanvas/src/viewers/base/viewport.ts     — Camera/viewport
```

---

## KiCad → kicanvas → sparkbench Mapping

| KiCad C++ | kicanvas TS | sparkbench TS (target) |
|-----------|-------------|------------------------|
| `GAL` | `Renderer` (abstract) | Reuse kicanvas `Renderer` |
| `Canvas2DRenderer` | `Canvas2DRenderer` | Reuse kicanvas impl |
| `WebGL2Renderer` | `WebGL2Renderer` | Reuse kicanvas impl |
| `SCH_PAINTER.draw()` | Schematic painters | New adapter painters reading `SchItem` |
| `PCB_PAINTER.draw()` | Board painters | New adapter painters reading `BoardItem` |
| `RENDER_SETTINGS` | Theme colors | `SchRenderSettings` |
| `VIEW` + R-tree | `ViewLayerSet` + bbox maps | Reuse kicanvas `ViewLayerSet` |
| `VIEW_ITEM` | Layer items + bboxes | `SchItem` with bbox cache |
| `TOOL_MANAGER` | — | Our `ToolManager` (keep) |
| `TOOL_INTERACTIVE` | — | Our `BaseTool` (keep) |
| `SELECTION` | Selection overlay | Our selection Set + overlay layer |
| `COMMIT` | — | Our `Commit`/`UndoStack` (keep, add view notify) |
| `EE_GRID_HELPER` | — | Our `GridHelper` (keep) |
| `SCH_SCREEN` | `KicadSch` | `SchematicDoc` (keep) |

---

## Drawing Primitive Mapping

| KiCad GAL method | kicanvas Renderer method | Notes |
|-----------------|-------------------------|-------|
| `DrawLine(a, b)` | `line([a, b])` | Direct |
| `DrawSegment(a, b, w)` | `line([a, b], w)` | Width param |
| `DrawPolyline(pts)` | `line(pts)` | Multi-point |
| `DrawPolygon(pts)` | `polygon(pts)` | Filled |
| `DrawCircle(c, r)` | `circle(c, r)` | Filled or stroked |
| `DrawArc(c, r, s, e)` | `arc(c, r, s, e)` | Arcs |
| `DrawRectangle(a, b)` | `polygon([corners])` | Convert to polygon |
| `DrawCurve(s, c1, c2, e)` | Not in kicanvas | Approximate with polyline |
| `SetIsFill/SetIsStroke` | `state.fill/stroke` | State stack |
| `Save()/Restore()` | `state.push()/pop()` | Transform stack |
| `Transform(matrix)` | `state.matrix = m` | 3x3 matrix |

---

## Rendering Quality Targets (from KiCad SCH_PAINTER)

### Symbols
- Body graphics: polyline, rectangle, circle, arc, bezier with fill modes (none, outline, background, hatch)
- Pin lines with shapes: line, inverted (circle), clock (triangle), input_low, output_low, non_logic
- Pin labels: number above line, name after pin end, respecting `pin_names.offset`
- Fields: reference, value, footprint, datasheet with per-field visibility and positioning
- DNP marker: diagonal X across symbol bbox
- Dangling indicator: open circle on unconnected pins

### Wires/Buses
- Solid lines with rounded caps
- Dashed/dotted line styles via stroke pattern
- Dangling indicators at unconnected endpoints
- Bus entry angles (45 degrees)
- Operating point voltage display (optional)

### Labels
- **Local label:** text with connection dot, no outline
- **Global label (5 shapes):**
  - Input: right-pointing arrow `>`
  - Output: left-pointing arrow `<`
  - Bidirectional: diamond `<>`
  - Tri-state: arrow with bar
  - Passive: rectangle
- **Hierarchical label:** flag shape matching global label shapes
- **Directive label:** dot, round, diamond shapes with connection line

### Junctions
- Filled circle at connection point
- Configurable diameter

### No-Connect
- X marker (two crossing lines)

### Sheets
- Rectangle with border
- Background fill with configurable color
- Sheet name and filename fields
- Sheet pins as hierarchical labels on perimeter

---

## Performance Considerations

1. **Retained mode:** kicanvas compiles draw commands into `RenderLayer` objects once. On viewport change (pan/zoom), layers are re-rendered from compiled state without re-executing painters. Only dirty layers get recompiled.

2. **Layer granularity:** With ~13 schematic layers, a single item mutation (e.g., move a wire) only repaints the `wire` layer and `selection_overlay` — not all 13.

3. **WebGL2 path:** For large schematics (1000+ items), the WebGL2 renderer tessellates geometry into GPU buffers. Pan/zoom is a single matrix uniform change — zero CPU work per frame.

4. **Bbox caching:** `ViewLayer.bboxes` maps items to their screen-space bounds. Hit testing is O(items-on-layer) but with a tight spatial filter. For true O(log n), add an R-tree (as KiCad does with `VIEW_RTREE`).

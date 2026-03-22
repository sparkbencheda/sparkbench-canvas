# SparkBench Canvas Code Review

Review of the sparkbench-canvas project — a VS Code extension forked from kicanvas (view-only) being converted into a full KiCad-compatible schematic editor.

---

## CRITICAL: No Save

The single biggest problem: **there is no save/export functionality**. You can edit items in memory but can't write them back to `.kicad_sch` format. Without this, it's fundamentally still a viewer with an editing facade.

---

## HIGH Priority Issues

### 1. Monolithic ToolManager (`src/editor/tools.ts`)
~600 lines handling selection, wire drawing, label placement, symbol placement, junctions, no-connects, and move — all in one class. No tool state machine (enter/active/exit lifecycle). Tool transitions are implicit and fragile.

### 2. `any` types everywhere
- `tools.ts:61` — `symLibrary: any = null`
- `items.ts:344` — `libSymbol: any`
- `tools.ts:437` — `as any` cast on label type

These defeat TypeScript's entire purpose and hide bugs.

### 3. Silent error swallowing (`sch-import.ts:154-180`)
Symbol pin loading wraps everything in a `catch` that silently proceeds with no pins. Symbols will appear but be unconnectable, with no indication why.

### 4. No electrical connectivity / net system
No validation that wires connect, no net merging, no floating net detection, no pin type checking. This is the core of what makes a schematic editor vs. a drawing tool.

### 5. No reference annotation
No automatic R1/R2/C1 assignment, no re-annotate, no collision detection.

### 6. Broken round-trip UUIDs (`sch-import.ts:100`)
Wire polylines get synthetic UUIDs like `${wire.uuid}-${i}`, breaking identity on reimport.

---

## MEDIUM Priority Issues

### 7. No property editing
Double-click shows a status message (`tools.ts:226`) but doesn't open a property dialog. Can't edit symbol values, label text properties, wire widths, etc.

### 8. `prompt()` for label text (`editor-overlay.ts:306`)
Blocks the browser thread. No validation, no multi-line support. Needs a proper dialog.

### 9. O(n) hit testing on every mouse move (`schematic-doc.ts:77-85`)
No spatial indexing. Will lag on schematics with hundreds of items.

### 10. Approximate bounding boxes
- `SchLabel.getBBox` (`items.ts:219-237`) estimates text width as `text.length * 1.0 + 2` — wildly inaccurate
- `SchSymbol.getBBox` has complex fallback logic that may not match visual bounds

### 11. Shallow clone in undo system (`undo.ts:32`, `items.ts:380-391`)
`SchSymbol.clone()` uses spread operators — nested objects share references, so undo can corrupt state.

### 12. Hardcoded everything
- Colors (`editor-renderer.ts:7-19`) — no theme support
- Grid size always 1.27mm — no zoom-adaptive grid
- Snap radius = `gridSize * 1.5` — no configuration
- Magic epsilons (`items.ts:113`, `schematic-doc.ts:113`) — `0.001`, `0.01`

### 13. File watcher overwrites edits (`extension.ts:134-148`)
External file changes send an "update" message that replaces editor content without warning, losing unsaved work.

### 14. No dirty flag
VS Code tab never shows the modified dot. Users will lose work closing the editor.

### 15. Symbol chooser resource leaks (`editor-overlay.ts:216-303`)
Debounce timer not cleared on modal close. Double-escape can try removing already-removed DOM nodes.

### 16. No marquee selection
Only single-click + shift-click. Can't drag to select multiple items.

### 17. Missing item types
No copy/paste, no hierarchy/sheets, no power symbols, no bus entries, no text objects. All defined in the type enum but unimplemented.

---

## LOW Priority

- Redundant coordinate conversions in `editor-overlay.ts`
- Grid draws lines individually instead of batching
- Vec2 allocations in hot paths (GC pressure)
- No VS Code command palette integration
- Arc rendering edge cases (`editor-renderer.ts:435-477`)
- Global label shapes don't match KiCad reference rendering

---

## Recommended Attack Order

1. **Implement save/export** — without this nothing else matters
2. **Add proper typing** — replace all `any` with real types
3. **Fix silent error handling** — surface errors to the user
4. **Decompose ToolManager** — one class per tool with a state machine
5. **Add dirty flag + save prompt** — prevent data loss
6. **Build net connectivity system** — the core editor value-add
7. **Replace `prompt()` with proper dialogs**
8. **Add spatial indexing** for hit testing
9. **Implement property editing** on double-click

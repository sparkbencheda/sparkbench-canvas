// Grid snapping - mirrors KiCad's EE_GRID_HELPER

import type { Vec2 } from "./types";
import type { SchematicDoc } from "./schematic-doc";
import { SchLine, SchJunction, SchLabel, SchSymbol } from "./items";

export enum SnapMode {
  GRID_ONLY = 0,   // Snap to grid intersections only
  GRID_WIRES = 1,  // Snap to wire endpoints, pins, labels, junctions
  GRID_SYMBOLS = 2, // Snap to symbol origins
}

export class GridHelper {
  gridSize = 1.27; // KiCad default: 50mil = 1.27mm
  snapEnabled = true;
  gridEnabled = true;

  snapToGrid(pos: Vec2): Vec2 {
    if (!this.gridEnabled) return pos;
    return {
      x: Math.round(pos.x / this.gridSize) * this.gridSize,
      y: Math.round(pos.y / this.gridSize) * this.gridSize,
    };
  }

  bestSnapAnchor(
    pos: Vec2,
    mode: SnapMode,
    doc: SchematicDoc | null,
    skip?: string, // Item ID to skip
  ): Vec2 {
    if (!this.snapEnabled) return this.snapToGrid(pos);
    if (!doc || mode === SnapMode.GRID_ONLY) return this.snapToGrid(pos);

    // Collect snap candidates from nearby items
    const snapRadius = this.gridSize * 1.5;
    let bestDist = snapRadius;
    let bestPoint: Vec2 | null = null;

    for (const item of doc.allItems()) {
      if (item.id === skip) continue;

      if (mode === SnapMode.GRID_WIRES) {
        // Snap to connection points
        if (item.isConnectable()) {
          for (const cp of item.getConnectionPoints()) {
            const dx = cp.x - pos.x;
            const dy = cp.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              bestPoint = cp;
            }
          }
        }
      } else if (mode === SnapMode.GRID_SYMBOLS) {
        if (item instanceof SchSymbol) {
          const dx = item.pos.x - pos.x;
          const dy = item.pos.y - pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) {
            bestDist = dist;
            bestPoint = { ...item.pos };
          }
        }
      }
    }

    return bestPoint ?? this.snapToGrid(pos);
  }
}

// Schematic document model - mirrors KiCad's SCH_SCREEN
// Manages all items on a schematic sheet and provides spatial queries

import { SchItem, SchLine, SchJunction, SchLabel, SchSymbol } from "./items";
import { UndoStack, ChangeType } from "./undo";
import type { Vec2, BBox } from "./types";
import { bboxContains } from "./types";

export class SchematicDoc {
  private items: Map<string, SchItem> = new Map();
  readonly undo = new UndoStack();
  fileName: string;
  title = "";
  revision = "";
  paperSize = "A4";

  constructor(fileName: string) {
    this.fileName = fileName;
  }

  // ==================== Item Management ====================

  addItem(item: SchItem): void {
    this.items.set(item.id, item);
  }

  removeItem(item: SchItem): void {
    this.items.delete(item.id);
  }

  getItem(id: string): SchItem | undefined {
    return this.items.get(id);
  }

  allItems(): IterableIterator<SchItem> {
    return this.items.values();
  }

  itemCount(): number {
    return this.items.size;
  }

  // ==================== Typed Queries ====================

  *wires(): IterableIterator<SchLine> {
    for (const item of this.items.values()) {
      if (item instanceof SchLine && item.layer === "wire") yield item;
    }
  }

  *buses(): IterableIterator<SchLine> {
    for (const item of this.items.values()) {
      if (item instanceof SchLine && item.layer === "bus") yield item;
    }
  }

  *junctions(): IterableIterator<SchJunction> {
    for (const item of this.items.values()) {
      if (item instanceof SchJunction) yield item;
    }
  }

  *labels(): IterableIterator<SchLabel> {
    for (const item of this.items.values()) {
      if (item instanceof SchLabel) yield item;
    }
  }

  *symbols(): IterableIterator<SchSymbol> {
    for (const item of this.items.values()) {
      if (item instanceof SchSymbol) yield item;
    }
  }

  // ==================== Spatial Queries ====================

  hitTest(pos: Vec2, accuracy = 1): SchItem[] {
    const hits: SchItem[] = [];
    for (const item of this.items.values()) {
      if (item.hitTest(pos, accuracy)) {
        hits.push(item);
      }
    }
    return hits;
  }

  itemsInArea(bbox: BBox): SchItem[] {
    const results: SchItem[] = [];
    for (const item of this.items.values()) {
      const itemBB = item.getBBox();
      // Check if item bbox overlaps query bbox
      if (
        itemBB.x + itemBB.width >= bbox.x &&
        itemBB.x <= bbox.x + bbox.width &&
        itemBB.y + itemBB.height >= bbox.y &&
        itemBB.y <= bbox.y + bbox.height
      ) {
        results.push(item);
      }
    }
    return results;
  }

  // ==================== Connection Queries ====================

  findConnectableAt(pos: Vec2, exclude?: SchItem): SchItem[] {
    const results: SchItem[] = [];
    for (const item of this.items.values()) {
      if (item === exclude) continue;
      if (!item.isConnectable()) continue;

      for (const cp of item.getConnectionPoints()) {
        if (Math.abs(cp.x - pos.x) < 0.01 && Math.abs(cp.y - pos.y) < 0.01) {
          results.push(item);
          break;
        }
      }
    }
    return results;
  }

  needsJunction(pos: Vec2): boolean {
    // A junction is needed where 3+ wires meet, or where a wire crosses a pin
    let wireCount = 0;
    let pinCount = 0;

    for (const item of this.items.values()) {
      if (item instanceof SchLine && item.layer === "wire") {
        for (const cp of item.getConnectionPoints()) {
          if (Math.abs(cp.x - pos.x) < 0.01 && Math.abs(cp.y - pos.y) < 0.01) {
            wireCount++;
            break;
          }
        }
      } else if (item instanceof SchSymbol) {
        for (const pinPos of item.getPinPositions()) {
          if (Math.abs(pinPos.x - pos.x) < 0.01 && Math.abs(pinPos.y - pos.y) < 0.01) {
            pinCount++;
            break;
          }
        }
      }
    }

    return wireCount >= 3 || (wireCount >= 1 && pinCount >= 1);
  }

  hasJunctionAt(pos: Vec2): boolean {
    for (const j of this.junctions()) {
      if (Math.abs(j.pos.x - pos.x) < 0.01 && Math.abs(j.pos.y - pos.y) < 0.01) {
        return true;
      }
    }
    return false;
  }

  // ==================== Undo/Redo Wrappers ====================

  commitAdd(item: SchItem, description: string): void {
    this.undo.stage(item, ChangeType.ADD);
    this.addItem(item);
    this.undo.push(description, () => {});
  }

  commitRemove(item: SchItem, description: string): void {
    this.undo.stage(item, ChangeType.REMOVE);
    this.removeItem(item);
    this.undo.push(description, () => {});
  }

  commitModify(item: SchItem): void {
    this.undo.stage(item, ChangeType.MODIFY);
  }

  commitPush(description: string): void {
    this.undo.push(description, () => {});
  }

  performUndo(): string | null {
    return this.undo.undo(
      (item) => this.addItem(item),
      (item) => this.removeItem(item),
      (item, snapshot) => this.restoreItem(item, snapshot),
    );
  }

  performRedo(): string | null {
    return this.undo.redo(
      (item) => this.addItem(item),
      (item) => this.removeItem(item),
      (item, snapshot) => this.restoreItem(item, snapshot),
    );
  }

  private restoreItem(item: SchItem, snapshot: SchItem): void {
    // Copy properties from snapshot back into item
    // This is type-specific
    if (item instanceof SchLine && snapshot instanceof SchLine) {
      item.start = { ...snapshot.start };
      item.end = { ...snapshot.end };
      item.stroke = { ...snapshot.stroke };
    } else if (item instanceof SchJunction && snapshot instanceof SchJunction) {
      item.pos = { ...snapshot.pos };
    } else if (item instanceof SchLabel && snapshot instanceof SchLabel) {
      item.pos = { ...snapshot.pos };
      item.text = snapshot.text;
      item.shape = snapshot.shape;
      item.spin = snapshot.spin;
    } else if (item instanceof SchSymbol && snapshot instanceof SchSymbol) {
      item.pos = { ...snapshot.pos };
      item.rotation = snapshot.rotation;
      item.mirror = snapshot.mirror;
      item.fields = snapshot.fields.map((f) => ({ ...f, pos: { ...f.pos } }));
    }
  }
}

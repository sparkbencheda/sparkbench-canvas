// Mutable document wrapper over KicadSch — replaces SchematicDoc
// Provides item management, undo/redo, and factory methods for creating items programmatically

import { Vec2 } from "../kicanvas/base/math";
import { Color } from "../kicanvas/base/color";
import { At, Stroke } from "../kicanvas/kicad/common";
import {
    KicadSch,
    Wire, Bus, BusEntry, Junction, NoConnect,
    NetLabel, GlobalLabel, HierarchicalLabel,
    SchematicSymbol, SchematicSheet,
    DefaultValues,
} from "../kicanvas/kicad/schematic";
import { type EditableItem, isEditable } from "../kicanvas/kicad/schematic-edit";
import { UndoStack, ChangeType } from "./undo";

export class KicadSchDoc {
    readonly sch: KicadSch;
    readonly undo = new UndoStack();
    dirty = false;

    constructor(sch: KicadSch) {
        this.sch = sch;
    }

    // ==================== Item Management ====================

    addItem(item: EditableItem): void {
        if (item instanceof Wire) {
            this.sch.wires.push(item);
        } else if (item instanceof Bus) {
            this.sch.buses.push(item);
        } else if (item instanceof BusEntry) {
            this.sch.bus_entries.push(item);
        } else if (item instanceof Junction) {
            this.sch.junctions.push(item);
        } else if (item instanceof NoConnect) {
            this.sch.no_connects.push(item);
        } else if (item instanceof NetLabel) {
            this.sch.net_labels.push(item);
        } else if (item instanceof GlobalLabel) {
            this.sch.global_labels.push(item);
        } else if (item instanceof HierarchicalLabel) {
            this.sch.hierarchical_labels.push(item);
        } else if (item instanceof SchematicSymbol) {
            this.sch.symbols.set(item.uuid, item);
        } else if (item instanceof SchematicSheet) {
            this.sch.sheets.push(item);
        }
    }

    removeItem(item: EditableItem): void {
        if (item instanceof Wire) {
            removeFrom(this.sch.wires, item);
        } else if (item instanceof Bus) {
            removeFrom(this.sch.buses, item);
        } else if (item instanceof BusEntry) {
            removeFrom(this.sch.bus_entries, item);
        } else if (item instanceof Junction) {
            removeFrom(this.sch.junctions, item);
        } else if (item instanceof NoConnect) {
            removeFrom(this.sch.no_connects, item);
        } else if (item instanceof NetLabel) {
            removeFrom(this.sch.net_labels, item);
        } else if (item instanceof GlobalLabel) {
            removeFrom(this.sch.global_labels, item);
        } else if (item instanceof HierarchicalLabel) {
            removeFrom(this.sch.hierarchical_labels, item);
        } else if (item instanceof SchematicSymbol) {
            this.sch.symbols.delete(item.uuid);
        } else if (item instanceof SchematicSheet) {
            removeFrom(this.sch.sheets, item);
        }
    }

    *allItems(): IterableIterator<any> {
        yield* this.sch.items();
    }

    itemCount(): number {
        let count = 0;
        for (const _ of this.sch.items()) count++;
        return count;
    }

    // ==================== Typed Queries ====================

    *wires(): IterableIterator<Wire> {
        yield* this.sch.wires;
    }

    *buses(): IterableIterator<Bus> {
        yield* this.sch.buses;
    }

    *junctions(): IterableIterator<Junction> {
        yield* this.sch.junctions;
    }

    *labels(): IterableIterator<NetLabel | GlobalLabel | HierarchicalLabel> {
        yield* this.sch.net_labels;
        yield* this.sch.global_labels;
        yield* this.sch.hierarchical_labels;
    }

    *symbols(): IterableIterator<SchematicSymbol> {
        yield* this.sch.symbols.values();
    }

    *noConnects(): IterableIterator<NoConnect> {
        yield* this.sch.no_connects;
    }

    // ==================== Connection Queries ====================

    findConnectableAt(pos: Vec2, exclude?: EditableItem): EditableItem[] {
        const results: EditableItem[] = [];
        for (const item of this.sch.items()) {
            if (item === exclude) continue;
            if (!isEditable(item) || !(item as EditableItem).isConnectable()) continue;
            for (const cp of (item as EditableItem).getConnectionPoints()) {
                if (Math.abs(cp.x - pos.x) < 0.001 && Math.abs(cp.y - pos.y) < 0.001) {
                    results.push(item as EditableItem);
                    break;
                }
            }
        }
        return results;
    }

    needsJunction(pos: Vec2): boolean {
        let wireCount = 0;
        let pinCount = 0;

        for (const wire of this.sch.wires) {
            for (const cp of (wire as any).getConnectionPoints()) {
                if (Math.abs(cp.x - pos.x) < 0.001 && Math.abs(cp.y - pos.y) < 0.001) {
                    wireCount++;
                    break;
                }
            }
        }

        for (const sym of this.sch.symbols.values()) {
            for (const cp of (sym as any).getConnectionPoints()) {
                if (Math.abs(cp.x - pos.x) < 0.001 && Math.abs(cp.y - pos.y) < 0.001) {
                    pinCount++;
                    break;
                }
            }
        }

        return wireCount >= 3 || (wireCount >= 1 && pinCount >= 1);
    }

    hasJunctionAt(pos: Vec2): boolean {
        for (const j of this.sch.junctions) {
            if (Math.abs(j.at.position.x - pos.x) < 0.001 &&
                Math.abs(j.at.position.y - pos.y) < 0.001) {
                return true;
            }
        }
        return false;
    }

    // ==================== Undo/Redo Wrappers ====================

    commitAdd(item: EditableItem, description: string): void {
        this.undo.stage(item, ChangeType.ADD);
        this.addItem(item);
        this.undo.push(description, () => {});
        this.dirty = true;
    }

    commitRemove(item: EditableItem, description: string): void {
        this.undo.stage(item, ChangeType.REMOVE);
        this.removeItem(item);
        this.undo.push(description, () => {});
        this.dirty = true;
    }

    commitModify(item: EditableItem): void {
        this.undo.stage(item, ChangeType.MODIFY);
    }

    commitPush(description: string): void {
        this.undo.push(description, () => {});
        this.dirty = true;
    }

    performUndo(): string | null {
        return this.undo.undo(
            (item) => this.addItem(item),
            (item) => this.removeItem(item),
            (item, snapshot) => restoreEditableItem(item, snapshot),
        );
    }

    performRedo(): string | null {
        return this.undo.redo(
            (item) => this.addItem(item),
            (item) => this.removeItem(item),
            (item, snapshot) => restoreEditableItem(item, snapshot),
        );
    }

    // ==================== Factory Methods ====================
    // Create KicadSch items programmatically (bypassing parser constructor)

    static createWire(pts: Vec2[]): Wire {
        const w = Object.create(Wire.prototype) as Wire;
        w.pts = pts.map(p => p.copy());
        w.uuid = crypto.randomUUID();
        w.stroke = Stroke.default_value() as any;
        (w as any).flags = 0;
        return w;
    }

    static createBus(pts: Vec2[]): Bus {
        const b = Object.create(Bus.prototype) as Bus;
        b.pts = pts.map(p => p.copy());
        b.uuid = crypto.randomUUID();
        b.stroke = Stroke.default_value() as any;
        (b as any).flags = 0;
        return b;
    }

    static createJunction(pos: Vec2): Junction {
        const j = Object.create(Junction.prototype) as Junction;
        j.at = new At();
        j.at.position = pos.copy();
        j.uuid = crypto.randomUUID();
        j.diameter = DefaultValues.junction_diameter;
        j.color = Color.transparent_black;
        (j as any).flags = 0;
        return j;
    }

    static createNoConnect(pos: Vec2): NoConnect {
        const nc = Object.create(NoConnect.prototype) as NoConnect;
        nc.at = new At();
        nc.at.position = pos.copy();
        nc.uuid = crypto.randomUUID();
        (nc as any).flags = 0;
        return nc;
    }

    static createNetLabel(pos: Vec2, text: string): NetLabel {
        const l = Object.create(NetLabel.prototype) as NetLabel;
        l.at = new At();
        l.at.position = pos.copy();
        l.text = text;
        l.uuid = crypto.randomUUID();
        l.effects = { font: { size: new Vec2(1.27, 1.27) } } as any;
        (l as any).flags = 0;
        return l;
    }

    static createGlobalLabel(pos: Vec2, text: string, shape = "input"): GlobalLabel {
        const l = Object.create(GlobalLabel.prototype) as GlobalLabel;
        l.at = new At();
        l.at.position = pos.copy();
        l.text = text;
        l.uuid = crypto.randomUUID();
        l.shape = shape as any;
        l.effects = { font: { size: new Vec2(1.27, 1.27) } } as any;
        l.properties = [];
        (l as any).flags = 0;
        return l;
    }
}

// ==================== Helpers ====================

function removeFrom<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx >= 0) arr.splice(idx, 1);
}

function restoreEditableItem(item: EditableItem, snapshot: EditableItem): void {
    // Copy mutable properties from snapshot back to item
    if (item instanceof Wire || item instanceof Bus) {
        const snap = snapshot as Wire;
        item.pts = snap.pts.map(p => p.copy());
        item.stroke = { ...snap.stroke } as any;
    } else if (item instanceof Junction) {
        const snap = snapshot as Junction;
        item.at = snap.at.copy();
        if (snap.diameter !== undefined) item.diameter = snap.diameter;
    } else if (item instanceof NoConnect) {
        const snap = snapshot as NoConnect;
        item.at = snap.at.copy();
    } else if (item instanceof NetLabel || item instanceof GlobalLabel || item instanceof HierarchicalLabel) {
        const snap = snapshot as NetLabel;
        item.at = snap.at.copy();
        item.text = snap.text;
        item.effects = snap.effects;
        if ("shape" in snap && "shape" in item) {
            (item as any).shape = (snap as any).shape;
        }
    } else if (item instanceof SchematicSymbol) {
        const snap = snapshot as SchematicSymbol;
        item.at = snap.at.copy();
        item.mirror = snap.mirror;
        // Copy properties
        item.properties = new Map();
        for (const [key, prop] of snap.properties) {
            const pc = Object.create(Object.getPrototypeOf(prop));
            pc.name = prop.name; pc.text = prop.text; pc.id = prop.id;
            if (prop.at) pc.at = prop.at.copy();
            pc.effects = prop.effects; pc.show_name = prop.show_name;
            item.properties.set(key, pc);
        }
    } else if (item instanceof SchematicSheet) {
        const snap = snapshot as SchematicSheet;
        item.at = snap.at.copy();
        item.size = snap.size.copy();
    }
}

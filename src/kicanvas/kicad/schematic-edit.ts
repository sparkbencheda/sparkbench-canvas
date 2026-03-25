/*
    Mutation support for kicanvas schematic items.
    Cleanroomed from KiCad 10 eeschema SCH_ITEM interface.
    Adds move/rotate/mirror/clone/flags to parsed items.
    Import this module once to augment all schematic item prototypes.
*/

import { Vec2 } from "../base/math";
import { At } from "./common";
import {
    Wire, Bus, BusEntry, Junction, NoConnect,
    NetLabel, GlobalLabel, HierarchicalLabel,
    SchematicSymbol, SchematicSheet,
} from "./schematic";

// ==================== Item Flags ====================

export const ItemFlags = {
    NONE: 0,
    SELECTED: 1 << 0,
    BRIGHTENED: 1 << 1,
    MODIFIED: 1 << 2,
    IS_NEW: 1 << 3,
};

// ==================== Editable Item Interface ====================

export interface EditableItem {
    uuid: string;
    flags: number;
    move(delta: Vec2): void;
    rotate(center: Vec2, ccw: boolean): void;
    mirrorH(centerX: number): void;
    mirrorV(centerY: number): void;
    clone(): EditableItem;
    getConnectionPoints(): Vec2[];
    isConnectable(): boolean;
}

// ==================== Geometry helpers ====================

function rotatePoint90(p, center, ccw) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    if (ccw) return new Vec2(center.x + dy, center.y - dx);
    return new Vec2(center.x - dy, center.y + dx);
}

function rotateAt90(at, center, ccw) {
    const np = rotatePoint90(at.position, center, ccw);
    at.position.set(np);
    at.rotation = (at.rotation + (ccw ? 270 : 90)) % 360;
}

function mirrorAtH(at, centerX) {
    at.position.set(2 * centerX - at.position.x, at.position.y);
    if (at.rotation === 90) at.rotation = 270;
    else if (at.rotation === 270) at.rotation = 90;
}

function mirrorAtV(at, centerY) {
    at.position.set(at.position.x, 2 * centerY - at.position.y);
    if (at.rotation === 0) at.rotation = 180;
    else if (at.rotation === 180) at.rotation = 0;
}

// ==================== Augment Wire / Bus (polyline items) ====================

for (const cls of [Wire, Bus]) {
    const p = cls.prototype;
    p.flags = 0;
    p.move = function(delta) { for (const pt of this.pts) pt.set(pt.x + delta.x, pt.y + delta.y); };
    p.rotate = function(center, ccw) { for (let i = 0; i < this.pts.length; i++) this.pts[i] = rotatePoint90(this.pts[i], center, ccw); };
    p.mirrorH = function(cx) { for (const pt of this.pts) pt.set(2 * cx - pt.x, pt.y); };
    p.mirrorV = function(cy) { for (const pt of this.pts) pt.set(pt.x, 2 * cy - pt.y); };
    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.pts = this.pts.map(p => p.copy());
        c.uuid = crypto.randomUUID();
        c.stroke = { ...this.stroke };
        c.flags = 0;
        return c;
    };
    p.getConnectionPoints = function() {
        if (this.pts.length < 2) return [];
        return [this.pts[0].copy(), this.pts[this.pts.length - 1].copy()];
    };
    p.isConnectable = function() { return true; };
}

// ==================== Augment BusEntry ====================

{
    const p = BusEntry.prototype;
    p.flags = 0;
    p.move = function(delta) { this.at.position.set(this.at.position.x + delta.x, this.at.position.y + delta.y); };
    p.rotate = function(center, ccw) {
        rotateAt90(this.at, center, ccw);
        const dx = this.size.x, dy = this.size.y;
        if (ccw) this.size.set(dy, -dx); else this.size.set(-dy, dx);
    };
    p.mirrorH = function(cx) { mirrorAtH(this.at, cx); this.size.set(-this.size.x, this.size.y); };
    p.mirrorV = function(cy) { mirrorAtV(this.at, cy); this.size.set(this.size.x, -this.size.y); };
    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.at = this.at.copy(); c.size = this.size.copy();
        c.uuid = crypto.randomUUID(); c.stroke = { ...this.stroke }; c.flags = 0;
        return c;
    };
    p.getConnectionPoints = function() {
        return [this.at.position.copy(), new Vec2(this.at.position.x + this.size.x, this.at.position.y + this.size.y)];
    };
    p.isConnectable = function() { return true; };
}

// ==================== Augment Junction / NoConnect ====================

for (const [cls, conn] of [[Junction, true], [NoConnect, true]]) {
    const p = (cls as any).prototype;
    p.flags = 0;
    p.move = function(delta) { this.at.position.set(this.at.position.x + delta.x, this.at.position.y + delta.y); };
    p.rotate = function(center, ccw) { rotateAt90(this.at, center, ccw); };
    p.mirrorH = function(cx) { mirrorAtH(this.at, cx); };
    p.mirrorV = function(cy) { mirrorAtV(this.at, cy); };
    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.at = this.at.copy(); c.uuid = crypto.randomUUID(); c.flags = 0;
        if (this.diameter !== undefined) c.diameter = this.diameter;
        if (this.color !== undefined) c.color = this.color;
        return c;
    };
    p.getConnectionPoints = function() { return [this.at.position.copy()]; };
    p.isConnectable = function() { return conn; };
}

// ==================== Augment Labels ====================

for (const cls of [NetLabel, GlobalLabel, HierarchicalLabel]) {
    const p = cls.prototype;
    p.flags = 0;
    p.move = function(delta) { this.at.position.set(this.at.position.x + delta.x, this.at.position.y + delta.y); };
    p.rotate = function(center, ccw) { rotateAt90(this.at, center, ccw); };
    p.mirrorH = function(cx) { mirrorAtH(this.at, cx); };
    p.mirrorV = function(cy) { mirrorAtV(this.at, cy); };
    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.at = this.at.copy(); c.text = this.text; c.uuid = crypto.randomUUID();
        c.effects = this.effects; c.flags = 0;
        if (this.shape !== undefined) c.shape = this.shape;
        if (this.properties) c.properties = [...this.properties];
        return c;
    };
    p.getConnectionPoints = function() { return [this.at.position.copy()]; };
    p.isConnectable = function() { return true; };
}

// ==================== Augment SchematicSymbol ====================

{
    const p = SchematicSymbol.prototype;
    p.flags = 0;

    p.move = function(delta) {
        this.at.position.set(this.at.position.x + delta.x, this.at.position.y + delta.y);
        for (const prop of this.properties.values()) {
            if (prop.at) prop.at.position.set(prop.at.position.x + delta.x, prop.at.position.y + delta.y);
        }
    };

    p.rotate = function(center, ccw) {
        rotateAt90(this.at, center, ccw);
        for (const prop of this.properties.values()) {
            if (prop.at) { const np = rotatePoint90(prop.at.position, center, ccw); prop.at.position.set(np); }
        }
    };

    p.mirrorH = function(cx) {
        mirrorAtH(this.at, cx);
        this.mirror = this.mirror === "x" ? undefined : "x";
        for (const prop of this.properties.values()) {
            if (prop.at) prop.at.position.set(2 * cx - prop.at.position.x, prop.at.position.y);
        }
    };

    p.mirrorV = function(cy) {
        mirrorAtV(this.at, cy);
        this.mirror = this.mirror === "y" ? undefined : "y";
        for (const prop of this.properties.values()) {
            if (prop.at) prop.at.position.set(prop.at.position.x, 2 * cy - prop.at.position.y);
        }
    };

    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.uuid = crypto.randomUUID(); c.id = c.uuid;
        c.at = this.at.copy(); c.lib_name = this.lib_name; c.lib_id = this.lib_id;
        c.mirror = this.mirror; c.unit = this.unit; c.convert = this.convert;
        c.in_bom = this.in_bom; c.on_board = this.on_board;
        c.exclude_from_sim = this.exclude_from_sim; c.dnp = this.dnp;
        c.fields_autoplaced = this.fields_autoplaced; c.parent = this.parent; c.flags = 0;
        c.properties = new Map();
        for (const [key, prop] of this.properties) {
            const pc = Object.create(Object.getPrototypeOf(prop));
            pc.name = prop.name; pc.text = prop.text; pc.id = prop.id;
            if (prop.at) pc.at = prop.at.copy();
            pc.effects = prop.effects; pc.show_name = prop.show_name;
            c.properties.set(key, pc);
        }
        c.pins = this.pins.map(pin => {
            const pc = Object.create(Object.getPrototypeOf(pin));
            pc.number = pin.number; pc.uuid = crypto.randomUUID(); pc.parent = c;
            return pc;
        });
        c.default_instance = { ...this.default_instance };
        c.instances = new Map(this.instances);
        return c;
    };

    p.getConnectionPoints = function() { return [this.at.position.copy()]; };
    p.isConnectable = function() { return true; };
}

// ==================== Augment SchematicSheet ====================

{
    const p = SchematicSheet.prototype;
    p.flags = 0;

    p.move = function(delta) {
        this.at.position.set(this.at.position.x + delta.x, this.at.position.y + delta.y);
        if (this.properties) {
            for (const prop of this.properties.values()) {
                if (prop.at) prop.at.position.set(prop.at.position.x + delta.x, prop.at.position.y + delta.y);
            }
        }
    };

    p.rotate = function(center, ccw) { rotateAt90(this.at, center, ccw); };
    p.mirrorH = function(cx) { mirrorAtH(this.at, cx); };
    p.mirrorV = function(cy) { mirrorAtV(this.at, cy); };

    p.clone = function() {
        const c = Object.create(Object.getPrototypeOf(this));
        c.uuid = crypto.randomUUID(); c.at = this.at.copy(); c.size = this.size.copy();
        c.flags = 0; c.fill = this.fill; c.stroke = this.stroke;
        c.name = this.name; c.filename = this.filename;
        return c;
    };

    p.getConnectionPoints = function() { return []; };
    p.isConnectable = function() { return false; };
}

// ==================== Utilities ====================

export function isEditable(item) {
    return item && typeof item === "object" && "uuid" in item && typeof item.move === "function";
}

export function initItemFlags(sch) {
    for (const item of sch.items()) {
        if (typeof item.flags !== "number") item.flags = 0;
    }
}

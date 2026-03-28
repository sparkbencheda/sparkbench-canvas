import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import type { ISymbolLibrary } from "../types";
import { Vec2 } from "../../kicanvas/base/math";
import { At, Effects } from "../../kicanvas/kicad/common";
import { SchematicSymbol, Property } from "../../kicanvas/kicad/schematic";

export class SymbolTool extends BaseTool {
  readonly type = ToolType.SYMBOL;
  symLibrary: ISymbolLibrary | null = null;

  async handleEvent(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const libId = await this.ctx.callbacks.requestSymbolChooser();
    if (!libId) return;

    const pos = evt.pos instanceof Vec2 ? evt.pos : new Vec2(evt.pos.x, evt.pos.y);

    // Create a SchematicSymbol programmatically (bypassing parser)
    const sym = Object.create(SchematicSymbol.prototype) as SchematicSymbol;
    sym.uuid = crypto.randomUUID();
    (sym as any).id = sym.uuid;
    sym.lib_id = libId;
    sym.lib_name = libId;
    sym.at = new At();
    sym.at.position = pos.copy();
    sym.mirror = undefined as any;
    sym.unit = 1;
    sym.convert = 1;
    sym.in_bom = true;
    sym.on_board = true;
    sym.exclude_from_sim = false;
    sym.dnp = false;
    sym.fields_autoplaced = true;
    (sym as any).flags = 0;

    // Create basic properties
    sym.properties = new Map<string, Property>();
    const refProp = createProperty("Reference", "?", 0, pos.x, pos.y - 2.54);
    sym.properties.set("Reference", refProp);
    const valProp = createProperty("Value", libId.split(":").pop() ?? libId, 1, pos.x, pos.y + 2.54);
    sym.properties.set("Value", valProp);
    const fpProp = createProperty("Footprint", "", 2, pos.x, pos.y + 5.08);
    sym.properties.set("Footprint", fpProp);

    sym.pins = [];
    sym.default_instance = { reference: "?", unit: 1, value: libId.split(":").pop() ?? libId, footprint: "" };
    sym.instances = new Map();

    // Link library symbol if available
    if (this.symLibrary) {
      const libSym = this.symLibrary.findLibSymbol(libId);
      if (libSym) {
        sym.parent = libSym;
        // Copy pins from lib symbol
        const allPins = [...(libSym.pins ?? [])];
        for (const child of libSym.children ?? []) {
          allPins.push(...(child.pins ?? []));
        }
        sym.pins = allPins.map(pin => {
          const pc = Object.create(Object.getPrototypeOf(pin));
          pc.number = pin.number;
          pc.uuid = crypto.randomUUID();
          pc.parent = sym;
          return pc;
        });
      }
    }

    this.ctx.doc.commitAdd(sym as any, "Place symbol");
    this.ctx.callbacks.requestRepaint();
  }
}

function createProperty(name: string, text: string, id: number, x: number, y: number): Property {
  const prop = Object.create(Property.prototype) as Property;
  prop.name = name;
  prop.text = text;
  prop.id = id;
  prop.at = new At();
  prop.at.position = new Vec2(x, y);
  prop.effects = new Effects();
  prop.show_name = false;
  return prop;
}

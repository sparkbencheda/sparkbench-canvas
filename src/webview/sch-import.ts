// Imports kicanvas KicadSch data into the editor's SchematicDoc

import type { KicadSch } from "../../vendor-kicanvas/src/kicad";
import type {
  Wire,
  Bus,
  Junction,
  NoConnect,
  NetLabel,
  GlobalLabel,
  HierarchicalLabel,
  SchematicSymbol,
  SchematicSheet,
} from "../../vendor-kicanvas/src/kicad/schematic";
import { SchematicDoc } from "../editor/schematic-doc";
import {
  SchLine,
  SchJunction,
  SchLabel,
  SchNoConnect,
  SchSymbol,
  SchSheet,
} from "../editor/items";
import { vec2 } from "../editor/types";

export function importKicadSch(sch: KicadSch): SchematicDoc {
  const doc = new SchematicDoc(sch.filename);
  doc.title = sch.title_block?.title ?? "";
  doc.revision = sch.title_block?.rev ?? "";

  // Import wires
  for (const wire of sch.wires) {
    importWire(doc, wire, "wire");
  }

  // Import buses
  for (const bus of sch.buses) {
    importWire(doc, bus, "bus");
  }

  // Import junctions
  for (const j of sch.junctions) {
    const junction = new SchJunction(
      { x: j.at.position.x, y: j.at.position.y },
      j.diameter || 1.0,
      j.uuid,
    );
    doc.addItem(junction);
  }

  // Import no-connects
  for (const nc of sch.no_connects) {
    const noConnect = new SchNoConnect(
      { x: nc.at.position.x, y: nc.at.position.y },
      nc.uuid,
    );
    doc.addItem(noConnect);
  }

  // Import net labels
  for (const lbl of sch.net_labels) {
    importLabel(doc, lbl, "label");
  }

  // Import global labels
  for (const lbl of sch.global_labels) {
    importLabel(doc, lbl, "global_label");
  }

  // Import hierarchical labels
  for (const lbl of sch.hierarchical_labels) {
    importLabel(doc, lbl, "hier_label");
  }

  // Import symbols
  for (const sym of sch.symbols.values()) {
    importSymbol(doc, sym);
  }

  // Import sheets
  for (const sheet of sch.sheets) {
    importSheet(doc, sheet);
  }

  return doc;
}

function importWire(
  doc: SchematicDoc,
  wire: Wire | Bus,
  layer: "wire" | "bus",
) {
  const pts = wire.pts;
  if (!pts || pts.length < 2) return;

  // KiCad wires can have multiple points (polyline segments)
  for (let i = 0; i < pts.length - 1; i++) {
    const start = { x: pts[i]!.x, y: pts[i]!.y };
    const end = { x: pts[i + 1]!.x, y: pts[i + 1]!.y };
    const line = new SchLine(start, end, layer);
    line.originalUuid = wire.uuid;
    line.segmentIndex = i;
    if (wire.stroke?.width) {
      line.stroke.width = wire.stroke.width;
    }
    doc.addItem(line);
  }
}

function importLabel(
  doc: SchematicDoc,
  lbl: NetLabel | GlobalLabel | HierarchicalLabel,
  labelType: "label" | "global_label" | "hier_label",
) {
  const label = new SchLabel(
    { x: lbl.at.position.x, y: lbl.at.position.y },
    lbl.text,
    labelType,
    lbl.uuid,
  );

  // Map rotation to spin style
  const rot = lbl.at.rotation ?? 0;
  if (rot === 0) label.spin = 0;       // LEFT
  else if (rot === 90) label.spin = 1;  // UP
  else if (rot === 180) label.spin = 2; // RIGHT
  else if (rot === 270) label.spin = 3; // DOWN

  doc.addItem(label);
}

function importSymbol(doc: SchematicDoc, sym: SchematicSymbol) {
  const pos = { x: sym.at.position.x, y: sym.at.position.y };
  const symbol = new SchSymbol(pos, sym.lib_id, sym.uuid);
  symbol.rotation = sym.at.rotation ?? 0;
  symbol.mirror = sym.mirror ?? "none";
  symbol.unit = sym.unit ?? 1;

  // Import properties as fields
  symbol.fields = [];
  if (sym.properties) {
    for (const [name, prop] of sym.properties) {
      symbol.fields.push({
        name,
        text: prop.text ?? "",
        pos: prop.at
          ? { x: prop.at.position.x - pos.x, y: prop.at.position.y - pos.y }
          : vec2(0, 0),
        visible: !prop.effects?.hide,
      });
    }
  }

  // Import pin positions and lib_symbol reference
  try {
    const libSym = sym.lib_symbol;
    if (libSym) {
      symbol.libSymbol = libSym;
      // Collect pins only from matching unit (unit 0 = common + active unit)
      const activeUnit = sym.unit ?? 1;
      const allPins = [...libSym.pins];
      for (const child of libSym.children) {
        const u = child.unit ?? 0;
        if (u === 0 || u === activeUnit) {
          allPins.push(...child.pins);
        }
      }
      for (const pin of allPins) {
        if (pin.at) {
          symbol.pins.push({
            number: pin.number?.text ?? "",
            name: pin.name?.text ?? "",
            pos: { x: pin.at.position.x, y: pin.at.position.y },
            type: "unspecified",
          });
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to load lib_symbol for ${sym.lib_id}:`, e);
  }

  doc.addItem(symbol);
}

function importSheet(doc: SchematicDoc, sheet: SchematicSheet) {
  const pos = { x: sheet.at.position.x, y: sheet.at.position.y };
  const size = { x: sheet.size.x, y: sheet.size.y };
  const name = sheet.properties?.get("Sheetname")?.text ?? "Sheet";
  const fileName = sheet.properties?.get("Sheetfile")?.text ?? "";

  const sch = new SchSheet(pos, size, name, fileName, sheet.uuid);
  doc.addItem(sch);
}

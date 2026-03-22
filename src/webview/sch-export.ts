// Serializes SchematicDoc back to KiCad .kicad_sch S-expression format

import { SchematicDoc } from "../editor/schematic-doc";
import {
  SchLine,
  SchJunction,
  SchLabel,
  SchNoConnect,
  SchSymbol,
  SchSheet,
  type SchItem,
} from "../editor/items";

function fmt(n: number): string {
  // KiCad uses up to 6 decimal places, strip trailing zeros
  const s = n.toFixed(6);
  // Remove trailing zeros after decimal point, keep at least 2 decimals
  const trimmed = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  // Ensure at least 2 decimal places for consistency
  if (!trimmed.includes(".")) return trimmed;
  const parts = trimmed.split(".");
  return parts[0] + "." + (parts[1] ?? "").padEnd(2, "0");
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function rotationForSpin(spin: number): number {
  // SpinStyle: 0=LEFT(0°), 1=UP(90°), 2=RIGHT(180°), 3=DOWN(270°)
  return [0, 90, 180, 270][spin] ?? 0;
}

function serializeWires(items: SchItem[]): string {
  const lines: string[] = [];

  // Group SchLines by originalUuid to reconstruct polylines
  const polylineGroups = new Map<string, SchLine[]>();
  const standaloneLines: SchLine[] = [];

  for (const item of items) {
    if (!(item instanceof SchLine)) continue;
    if (item.layer === "notes") continue; // skip graphic lines

    if (item.originalUuid) {
      const group = polylineGroups.get(item.originalUuid) ?? [];
      group.push(item);
      polylineGroups.set(item.originalUuid, group);
    } else {
      standaloneLines.push(item);
    }
  }

  // Serialize polyline groups
  for (const [uuid, segments] of polylineGroups) {
    segments.sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
    const tag = segments[0]!.layer === "bus" ? "bus" : "wire";
    const pts: string[] = [];
    pts.push(`(xy ${fmt(segments[0]!.start.x)} ${fmt(segments[0]!.start.y)})`);
    for (const seg of segments) {
      pts.push(`(xy ${fmt(seg.end.x)} ${fmt(seg.end.y)})`);
    }
    const strokeWidth = segments[0]!.stroke.width;
    lines.push(
      `  (${tag} (pts ${pts.join(" ")})\n` +
      `    (stroke (width ${fmt(strokeWidth)}) (type default))\n` +
      `    (uuid "${uuid}")\n` +
      `  )`,
    );
  }

  // Serialize standalone lines (each as a 2-point wire)
  for (const line of standaloneLines) {
    const tag = line.layer === "bus" ? "bus" : "wire";
    lines.push(
      `  (${tag} (pts (xy ${fmt(line.start.x)} ${fmt(line.start.y)}) (xy ${fmt(line.end.x)} ${fmt(line.end.y)}))\n` +
      `    (stroke (width ${fmt(line.stroke.width)}) (type default))\n` +
      `    (uuid "${line.id}")\n` +
      `  )`,
    );
  }

  return lines.join("\n");
}

function serializeJunctions(items: SchItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (!(item instanceof SchJunction)) continue;
    lines.push(
      `  (junction (at ${fmt(item.pos.x)} ${fmt(item.pos.y)}) (diameter ${fmt(item.diameter)}) (color 0 0 0 0)\n` +
      `    (uuid "${item.id}")\n` +
      `  )`,
    );
  }
  return lines.join("\n");
}

function serializeNoConnects(items: SchItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (!(item instanceof SchNoConnect)) continue;
    lines.push(
      `  (no_connect (at ${fmt(item.pos.x)} ${fmt(item.pos.y)}) (uuid "${item.id}"))`,
    );
  }
  return lines.join("\n");
}

function serializeLabels(items: SchItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (!(item instanceof SchLabel)) continue;

    const rot = rotationForSpin(item.spin);
    let tag: string;
    switch (item.labelType) {
      case "global_label":
        tag = "global_label";
        break;
      case "hier_label":
        tag = "hierarchical_label";
        break;
      default:
        tag = "label";
    }

    let shapeAttr = "";
    if (tag === "global_label" || tag === "hierarchical_label") {
      const shapes = ["input", "output", "bidirectional", "tri_state", "passive"];
      shapeAttr = ` (shape ${shapes[item.shape] ?? "input"})`;
    }

    lines.push(
      `  (${tag} ${quote(item.text)} (at ${fmt(item.pos.x)} ${fmt(item.pos.y)} ${rot})${shapeAttr}\n` +
      `    (effects (font (size 1.27 1.27)) (justify left))\n` +
      `    (uuid "${item.id}")\n` +
      `  )`,
    );
  }
  return lines.join("\n");
}

function serializeSymbols(items: SchItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (!(item instanceof SchSymbol)) continue;

    const mirrorStr = item.mirror !== "none" ? `(mirror ${item.mirror})` : "";
    const parts: string[] = [];
    parts.push(`  (symbol (lib_id ${quote(item.libId)}) (at ${fmt(item.pos.x)} ${fmt(item.pos.y)} ${item.rotation})${mirrorStr ? " " + mirrorStr : ""}`);
    parts.push(`    (unit ${item.unit})`);

    // Serialize fields as properties
    for (let i = 0; i < item.fields.length; i++) {
      const field = item.fields[i]!;
      const worldPos = item.transformPoint(field.pos);
      const hideStr = field.visible ? "" : " hide";
      parts.push(
        `    (property ${quote(field.name)} ${quote(field.text)} (at ${fmt(worldPos.x)} ${fmt(worldPos.y)} 0)` +
        `\n      (effects (font (size 1.27 1.27))${hideStr})` +
        `\n    )`,
      );
    }

    // Serialize pin assignments
    for (const pin of item.pins) {
      parts.push(`    (pin ${quote(pin.number)} (uuid "${item.id}-pin-${pin.number}"))`);
    }

    parts.push(`    (instances\n      (project ""\n        (path "/"\n          (reference "${item.reference}") (unit ${item.unit})\n        )\n      )\n    )`);
    parts.push(`    (uuid "${item.id}")`);
    parts.push(`  )`);
    lines.push(parts.join("\n"));
  }
  return lines.join("\n");
}

function serializeSheets(items: SchItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (!(item instanceof SchSheet)) continue;

    const parts: string[] = [];
    parts.push(`  (sheet (at ${fmt(item.pos.x)} ${fmt(item.pos.y)}) (size ${fmt(item.size.x)} ${fmt(item.size.y)})`);

    for (const field of item.fields) {
      const hideStr = field.visible ? "" : " hide";
      parts.push(
        `    (property ${quote(field.name)} ${quote(field.text)} (at ${fmt(item.pos.x + field.pos.x)} ${fmt(item.pos.y + field.pos.y)} 0)` +
        `\n      (effects (font (size 1.27 1.27))${hideStr})` +
        `\n    )`,
      );
    }

    parts.push(`    (uuid "${item.id}")`);
    parts.push(`  )`);
    lines.push(parts.join("\n"));
  }
  return lines.join("\n");
}

/**
 * Extract the (lib_symbols ...) block from the original file content.
 * We pass it through verbatim since we don't modify library symbols.
 */
function extractLibSymbols(originalContent: string): string {
  // Find the (lib_symbols ...) top-level block
  const startIdx = originalContent.indexOf("(lib_symbols");
  if (startIdx === -1) return "";

  // Match balanced parentheses
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < originalContent.length; i++) {
    if (originalContent[i] === "(") depth++;
    if (originalContent[i] === ")") depth--;
    if (depth === 0) {
      endIdx = i + 1;
      break;
    }
  }

  return "  " + originalContent.slice(startIdx, endIdx).trim();
}

/**
 * Extract sheet_instances and symbol_instances blocks from original content.
 */
function extractInstances(originalContent: string): string {
  const blocks: string[] = [];
  for (const tag of ["sheet_instances", "symbol_instances"]) {
    const startIdx = originalContent.indexOf(`(${tag}`);
    if (startIdx === -1) continue;
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < originalContent.length; i++) {
      if (originalContent[i] === "(") depth++;
      if (originalContent[i] === ")") depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
    blocks.push("  " + originalContent.slice(startIdx, endIdx).trim());
  }
  return blocks.join("\n\n");
}

/**
 * Export a SchematicDoc to KiCad .kicad_sch format.
 *
 * @param doc - The editor document to serialize
 * @param originalContent - The original file content for pass-through sections (lib_symbols, instances)
 */
export function exportToKicadSch(
  doc: SchematicDoc,
  originalContent?: string,
): string {
  const allItems = [...doc.allItems()];

  const sections: string[] = [];

  // Header
  sections.push(`(kicad_sch (version 20231120) (generator "sparkbench") (generator_version "0.1")`);
  sections.push(`  (uuid "${doc.fileName}")`);
  sections.push(`  (paper "${doc.paperSize}")`);

  // Title block
  if (doc.title || doc.revision) {
    const tbParts: string[] = [];
    tbParts.push(`  (title_block`);
    if (doc.title) tbParts.push(`    (title ${quote(doc.title)})`);
    if (doc.revision) tbParts.push(`    (rev ${quote(doc.revision)})`);
    tbParts.push(`  )`);
    sections.push(tbParts.join("\n"));
  }

  // lib_symbols (pass-through from original)
  if (originalContent) {
    const libSymbols = extractLibSymbols(originalContent);
    if (libSymbols) sections.push(libSymbols);
  }

  // Wires and buses
  const wires = serializeWires(allItems);
  if (wires) sections.push(wires);

  // Junctions
  const junctions = serializeJunctions(allItems);
  if (junctions) sections.push(junctions);

  // No-connects
  const noConnects = serializeNoConnects(allItems);
  if (noConnects) sections.push(noConnects);

  // Labels
  const labels = serializeLabels(allItems);
  if (labels) sections.push(labels);

  // Symbols
  const symbols = serializeSymbols(allItems);
  if (symbols) sections.push(symbols);

  // Sheets
  const sheets = serializeSheets(allItems);
  if (sheets) sections.push(sheets);

  // Instances (pass-through from original)
  if (originalContent) {
    const instances = extractInstances(originalContent);
    if (instances) sections.push(instances);
  }

  sections.push(")");
  return sections.join("\n\n") + "\n";
}

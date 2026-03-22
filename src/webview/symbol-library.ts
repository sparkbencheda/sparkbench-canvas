// Symbol library index - aggregates symbols from embedded lib_symbols and standalone .kicad_sym files

import type { KicadSch } from "../../vendor-kicanvas/src/kicad";
import {
  LibSymbol,
} from "../../vendor-kicanvas/src/kicad/schematic";
import { listify } from "../../vendor-kicanvas/src/kicad/tokenizer";
import { parse_expr, P, T } from "../../vendor-kicanvas/src/kicad/parser";

export interface SymbolEntry {
  fullId: string;       // "LibName:SymbolName"
  libraryName: string;
  symbolName: string;
  libSymbol: LibSymbol | null; // null = stub from global index, not yet loaded
}

/** Parse a sym-lib-table file and extract (name, uri) pairs */
function parseSymLibTable(content: string): { name: string; uri: string }[] {
  const results: { name: string; uri: string }[] = [];
  const libRegex = /\(lib\s+\(name\s+"([^"]+)"\).*?\(uri\s+"([^"]+)"\)/g;
  let match;
  while ((match = libRegex.exec(content)) !== null) {
    results.push({ name: match[1]!, uri: match[2]! });
  }
  return results;
}

/** Parse a .kicad_sym file and extract LibSymbol objects */
function parseKicadSymFile(content: string): LibSymbol[] {
  try {
    const expr = listify(content);
    const top = expr.length === 1 && Array.isArray(expr[0]) ? expr[0] : expr;

    // Parse the kicad_symbol_lib envelope
    const parsed = parse_expr(
      top as any,
      P.start("kicad_symbol_lib"),
      P.pair("version", T.number),
      P.pair("generator", T.string),
      P.pair("generator_version", T.string),
      P.collection("symbols", "symbol", T.item(LibSymbol)),
    );
    return (parsed as any).symbols ?? [];
  } catch (e) {
    console.warn("Failed to parse .kicad_sym file:", e);
    return [];
  }
}

export class SymbolLibrary {
  private entries: SymbolEntry[] = [];
  private byFullId = new Map<string, SymbolEntry>();

  /** Build from embedded lib_symbols + project files */
  static build(
    kicadSch: KicadSch | null,
    projectFiles: Record<string, string>,
  ): SymbolLibrary {
    const lib = new SymbolLibrary();

    // 1. Add embedded lib_symbols from the schematic
    if (kicadSch?.lib_symbols) {
      for (const sym of kicadSch.lib_symbols.symbols) {
        // Skip child sub-units (they contain '_' unit encoding)
        if (sym.parent instanceof LibSymbol) continue;

        const name = sym.name;
        const libName = name.includes(":") ? name.split(":")[0]! : "embedded";
        const symName = name.includes(":") ? name.split(":").slice(1).join(":") : name;
        lib.addEntry(libName, symName, sym);
      }
    }

    // 2. Parse sym-lib-table to discover standalone library files
    const symLibTable = projectFiles["sym-lib-table"];
    if (symLibTable) {
      const libs = parseSymLibTable(symLibTable);
      for (const { name, uri } of libs) {
        // Resolve ${KIPRJMOD} - all files are flat in projectFiles
        const resolvedUri = uri.replace(/\$\{KIPRJMOD\}\//, "");
        const symFileContent = projectFiles[resolvedUri];
        if (symFileContent) {
          const symbols = parseKicadSymFile(symFileContent);
          for (const sym of symbols) {
            if (sym.parent instanceof LibSymbol) continue;
            const symName = sym.name.includes(":")
              ? sym.name.split(":").slice(1).join(":")
              : sym.name;
            lib.addEntry(name, symName, sym);
          }
        }
      }
    }

    // 3. Also add any .kicad_sym files not in the lib table
    for (const [fileName, content] of Object.entries(projectFiles)) {
      if (!fileName.endsWith(".kicad_sym")) continue;
      const libName = fileName.replace(".kicad_sym", "");
      // Skip if already loaded via sym-lib-table
      if (lib.entries.some((e) => e.libraryName === libName)) continue;

      const symbols = parseKicadSymFile(content);
      for (const sym of symbols) {
        if (sym.parent instanceof LibSymbol) continue;
        const symName = sym.name.includes(":")
          ? sym.name.split(":").slice(1).join(":")
          : sym.name;
        lib.addEntry(libName, symName, sym);
      }
    }

    return lib;
  }

  private addEntry(libraryName: string, symbolName: string, libSymbol: LibSymbol) {
    const fullId = `${libraryName}:${symbolName}`;
    // Don't duplicate
    if (this.byFullId.has(fullId)) return;
    const entry: SymbolEntry = { fullId, libraryName, symbolName, libSymbol };
    this.entries.push(entry);
    this.byFullId.set(fullId, entry);
  }

  /** Search symbols by query string (matches against fullId) */
  search(query: string): SymbolEntry[] {
    if (!query) return this.entries;
    const q = query.toLowerCase();
    return this.entries.filter((e) => e.fullId.toLowerCase().includes(q));
  }

  /** Get symbol by full ID (e.g., "Device:R") */
  getByFullId(id: string): SymbolEntry | undefined {
    return this.byFullId.get(id);
  }

  /** Get all entries grouped by library */
  getGrouped(): Map<string, SymbolEntry[]> {
    const groups = new Map<string, SymbolEntry[]>();
    for (const entry of this.entries) {
      const list = groups.get(entry.libraryName) ?? [];
      list.push(entry);
      groups.set(entry.libraryName, list);
    }
    return groups;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Get a LibSymbol matching a lib_id (tries exact match, then name-only match) */
  findLibSymbol(libId: string): LibSymbol | undefined {
    const entry = this.byFullId.get(libId);
    if (entry?.libSymbol) return entry.libSymbol;

    // Try matching by symbol name only (without library prefix)
    const nameOnly = libId.includes(":") ? libId.split(":").slice(1).join(":") : libId;
    for (const e of this.entries) {
      if (e.symbolName === nameOnly && e.libSymbol) return e.libSymbol;
    }
    return undefined;
  }

  /** Add stub entries from a global library index (symbol names only, no parsed data) */
  addGlobalIndex(index: { libraries: { name: string; symbolNames: string[] }[] }): void {
    for (const lib of index.libraries) {
      for (const symName of lib.symbolNames) {
        const fullId = `${lib.name}:${symName}`;
        if (!this.byFullId.has(fullId)) {
          const entry: SymbolEntry = { fullId, libraryName: lib.name, symbolName: symName, libSymbol: null };
          this.entries.push(entry);
          this.byFullId.set(fullId, entry);
        }
      }
    }
  }

  /** Load a full library file, replacing stubs with real LibSymbol data */
  loadLibraryContent(libraryName: string, content: string): void {
    const symbols = parseKicadSymFile(content);
    for (const sym of symbols) {
      if (sym.parent instanceof LibSymbol) continue;
      const symName = sym.name.includes(":")
        ? sym.name.split(":").slice(1).join(":")
        : sym.name;
      const fullId = `${libraryName}:${symName}`;
      const existing = this.byFullId.get(fullId);
      if (existing) {
        existing.libSymbol = sym;
      } else {
        this.addEntry(libraryName, symName, sym);
      }
    }
  }

  /** Check if an entry's library data is loaded */
  isLoaded(fullId: string): boolean {
    const entry = this.byFullId.get(fullId);
    return entry?.libSymbol != null;
  }
}

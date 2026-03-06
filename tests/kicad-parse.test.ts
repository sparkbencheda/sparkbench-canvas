import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { KicadPCB } from "../vendor-kicanvas/src/kicad/board";
import { KicadSch } from "../vendor-kicanvas/src/kicad/schematic";

const examplesDir = resolve(__dirname, "../examples/tracelinkbase");

describe("KicadPCB parsing", () => {
  const pcbContent = readFileSync(
    resolve(examplesDir, "synflightIMU.kicad_pcb"),
    "utf-8",
  );
  const board = new KicadPCB("synflightIMU.kicad_pcb", pcbContent);

  it("parses version", () => {
    expect(board.version).toBeTypeOf("number");
    expect(board.version).toBeGreaterThan(0);
  });

  it("parses layers", () => {
    expect(board.layers.length).toBeGreaterThan(0);
    const layerNames = board.layers.map((l: any) => l.canonical_name);
    expect(layerNames).toContain("F.Cu");
    expect(layerNames).toContain("B.Cu");
  });

  it("parses footprints", () => {
    expect(board.footprints.length).toBeGreaterThan(0);
  });

  it("footprints have references", () => {
    const withRef = board.footprints.filter(
      (fp: any) => fp.reference && fp.reference !== "",
    );
    expect(withRef.length).toBeGreaterThan(0);
  });

  it("parses nets", () => {
    expect(board.nets.length).toBeGreaterThan(0);
  });

  it("parses segments (traces)", () => {
    expect(board.segments.length).toBeGreaterThan(0);
  });

  it("parses general properties", () => {
    expect(board.general).toBeDefined();
    expect(board.general!.thickness).toBeTypeOf("number");
  });
});

describe("KicadSch parsing", () => {
  const schContent = readFileSync(
    resolve(examplesDir, "synflightIMU.kicad_sch"),
    "utf-8",
  );
  const sch = new KicadSch("synflightIMU.kicad_sch", schContent);

  it("parses version", () => {
    expect(sch.version).toBeTypeOf("number");
    expect(sch.version).toBeGreaterThan(0);
  });

  it("parses uuid", () => {
    expect(sch.uuid).toBeDefined();
    expect(sch.uuid.length).toBeGreaterThan(0);
  });

  it("parses symbols", () => {
    expect(sch.symbols.size).toBeGreaterThan(0);
  });

  it("symbols have lib_id", () => {
    for (const [, sym] of sch.symbols) {
      expect(sym.lib_id).toBeDefined();
      break;
    }
  });

  it("parses wires", () => {
    expect(sch.wires.length).toBeGreaterThan(0);
  });

  it("parses labels", () => {
    const totalLabels =
      sch.net_labels.length +
      sch.global_labels.length +
      sch.hierarchical_labels.length;
    expect(totalLabels).toBeGreaterThanOrEqual(0);
  });
});

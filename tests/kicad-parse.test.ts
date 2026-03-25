import { describe, it, expect } from "vitest";
import { KicadPCB } from "../src/kicanvas/kicad/board";
import { KicadSch } from "../src/kicanvas/kicad/schematic";

const pcbContent = `(kicad_pcb
  (version 20240108)
  (generator "sparkbench-test")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (segment
    (start 0 0)
    (end 10 0)
    (width 0.25)
    (layer "F.Cu")
    (net 1))
)`;

const schContent = `(kicad_sch
  (version 20231120)
  (generator "sparkbench-test")
  (uuid "test-schematic")
  (wire
    (pts (xy 0 0) (xy 10 0))
    (stroke (width 0) (type default) (color 0 0 0 0))
    (uuid "wire-1"))
  (label "N$1"
    (at 10 0 0)
    (effects (font (size 1.27 1.27)))
    (uuid "label-1"))
)`;

describe("KicadPCB parsing", () => {
  const board = new KicadPCB("test.kicad_pcb", pcbContent);

  it("parses version", () => {
    expect(board.version).toBe(20240108);
  });

  it("parses layers", () => {
    expect(board.layers.length).toBe(2);
    const layerNames = board.layers.map((l) => l.canonical_name);
    expect(layerNames).toContain("F.Cu");
    expect(layerNames).toContain("B.Cu");
  });

  it("parses nets", () => {
    expect(board.nets.length).toBe(2);
    expect(board.nets[1]?.name).toBe("GND");
  });

  it("parses segments (traces)", () => {
    expect(board.segments.length).toBe(1);
    expect(board.segments[0]?.layer).toBe("F.Cu");
  });
});

describe("KicadSch parsing", () => {
  const sch = new KicadSch("test.kicad_sch", schContent);

  it("parses version and uuid", () => {
    expect(sch.version).toBe(20231120);
    expect(sch.uuid).toBe("test-schematic");
  });

  it("parses wires", () => {
    expect(sch.wires.length).toBe(1);
    expect(sch.wires[0]?.pts).toHaveLength(2);
  });

  it("parses labels", () => {
    expect(sch.net_labels.length).toBe(1);
    expect(sch.net_labels[0]?.text).toBe("N$1");
  });
});

import { describe, it, expect } from "vitest";
import {
  vec2, vec2Add, vec2Sub, vec2Eq, vec2Dist,
  bboxContains, bboxFromPoints,
} from "../src/editor/types";

describe("vec2 utilities", () => {
  it("creates a vec2", () => {
    expect(vec2(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it("adds vectors", () => {
    expect(vec2Add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
  });

  it("subtracts vectors", () => {
    expect(vec2Sub(vec2(5, 7), vec2(2, 3))).toEqual({ x: 3, y: 4 });
  });

  it("compares equal vectors", () => {
    expect(vec2Eq(vec2(1, 2), vec2(1, 2))).toBe(true);
    expect(vec2Eq(vec2(1, 2), vec2(1.0005, 2.0005))).toBe(true);
    expect(vec2Eq(vec2(1, 2), vec2(2, 2))).toBe(false);
  });

  it("computes distance", () => {
    expect(vec2Dist(vec2(0, 0), vec2(3, 4))).toBeCloseTo(5);
    expect(vec2Dist(vec2(1, 1), vec2(1, 1))).toBe(0);
  });
});

describe("bbox utilities", () => {
  it("bboxContains checks point inside", () => {
    const bb = { x: 0, y: 0, width: 10, height: 10 };
    expect(bboxContains(bb, vec2(5, 5))).toBe(true);
    expect(bboxContains(bb, vec2(0, 0))).toBe(true);
    expect(bboxContains(bb, vec2(10, 10))).toBe(true);
    expect(bboxContains(bb, vec2(11, 5))).toBe(false);
    expect(bboxContains(bb, vec2(-1, 5))).toBe(false);
  });

  it("bboxFromPoints computes enclosing bbox", () => {
    const bb = bboxFromPoints([vec2(1, 2), vec2(5, 8), vec2(3, 4)]);
    expect(bb).toEqual({ x: 1, y: 2, width: 4, height: 6 });
  });

  it("bboxFromPoints handles empty array", () => {
    const bb = bboxFromPoints([]);
    expect(bb).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("bboxFromPoints handles single point", () => {
    const bb = bboxFromPoints([vec2(5, 3)]);
    expect(bb).toEqual({ x: 5, y: 3, width: 0, height: 0 });
  });
});

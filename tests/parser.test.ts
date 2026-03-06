import { describe, it, expect } from "vitest";
import { parse_expr, P, T } from "../vendor-kicanvas/src/kicad/parser";

describe("parse_expr", () => {
  it("parses a start + positional", () => {
    const result = parse_expr(
      '(thing "hello")',
      P.start("thing"),
      P.positional("name", T.string),
    );
    expect(result.name).toBe("hello");
  });

  it("parses pairs", () => {
    const result = parse_expr(
      "(thing (version 5) (name test))",
      P.start("thing"),
      P.pair("version", T.number),
      P.pair("name", T.string),
    );
    expect(result.version).toBe(5);
    expect(result.name).toBe("test");
  });

  it("parses atoms as booleans", () => {
    const result = parse_expr(
      "(thing locked)",
      P.start("thing"),
      P.atom("locked"),
    );
    expect(result.locked).toBe(true);
  });

  it("parses atom with choices", () => {
    const result = parse_expr(
      "(thing left)",
      P.start("thing"),
      P.atom("align", ["left", "right", "center"]),
    );
    expect(result.align).toBe("left");
  });

  it("parses lists", () => {
    const result = parse_expr(
      "(thing (items 1 2 3))",
      P.start("thing"),
      P.list("items", T.number),
    );
    expect(result.items).toEqual([1, 2, 3]);
  });

  it("parses collections", () => {
    const result = parse_expr(
      "(thing (item 1) (item 2) (item 3))",
      P.start("thing"),
      P.collection("items", "item", T.any),
    );
    expect(result.items).toHaveLength(3);
    // Each collected element is the full sub-expression
    expect(result.items[0]).toEqual(["item", 1]);
    expect(result.items[1]).toEqual(["item", 2]);
    expect(result.items[2]).toEqual(["item", 3]);
  });

  it("parses nested objects", () => {
    const result = parse_expr(
      "(thing (inner (x 1) (y 2)))",
      P.start("thing"),
      P.object("inner", {}, P.pair("x", T.number), P.pair("y", T.number)),
    );
    expect(result.inner.x).toBe(1);
    expect(result.inner.y).toBe(2);
  });

  it("parses boolean values", () => {
    expect(T.boolean({}, "x", "yes")).toBe(true);
    expect(T.boolean({}, "x", "no")).toBe(false);
    expect(T.boolean({}, "x", "true")).toBe(true);
    expect(T.boolean({}, "x", "false")).toBe(false);
  });

  it("throws on wrong start token", () => {
    expect(() =>
      parse_expr("(wrong_start)", P.start("expected")),
    ).toThrow();
  });

  it("parses from string input", () => {
    const result = parse_expr(
      "(thing (version 3))",
      P.start("thing"),
      P.pair("version", T.number),
    );
    expect(result.version).toBe(3);
  });
});

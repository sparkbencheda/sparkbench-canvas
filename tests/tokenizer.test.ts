import { describe, it, expect } from "vitest";
import { tokenize, Token, listify } from "../src/kicanvas/kicad/tokenizer";

function tokens(input: string) {
  return Array.from(tokenize(input));
}

describe("tokenizer", () => {
  it("tokenizes open and close parens", () => {
    const t = tokens("()");
    expect(t).toHaveLength(2);
    expect(t[0]!.type).toBe(Token.OPEN);
    expect(t[1]!.type).toBe(Token.CLOSE);
  });

  it("tokenizes atoms", () => {
    const t = tokens("(kicad_pcb)");
    expect(t).toHaveLength(3);
    expect(t[1]!.type).toBe(Token.ATOM);
    expect(t[1]!.value).toBe("kicad_pcb");
  });

  it("tokenizes integers", () => {
    const t = tokens("(version 42)");
    expect(t[2]!.type).toBe(Token.NUMBER);
    expect(t[2]!.value).toBe(42);
  });

  it("tokenizes floats", () => {
    const t = tokens("(width 0.25)");
    expect(t[2]!.type).toBe(Token.NUMBER);
    expect(t[2]!.value).toBeCloseTo(0.25);
  });

  it("tokenizes negative numbers", () => {
    const t = tokens("(at -3.5 2.1)");
    expect(t[2]!.type).toBe(Token.NUMBER);
    expect(t[2]!.value).toBeCloseTo(-3.5);
  });

  it("tokenizes quoted strings", () => {
    const t = tokens('(name "hello world")');
    expect(t[2]!.type).toBe(Token.STRING);
    expect(t[2]!.value).toBe("hello world");
  });

  it("handles escaped characters in strings", () => {
    const t = tokens('(text "line1\\nline2")');
    expect(t[2]!.value).toBe("line1\nline2");
  });

  it("handles escaped backslash in strings", () => {
    const t = tokens('(text "path\\\\file")');
    expect(t[2]!.value).toBe("path\\file");
  });

  it("tokenizes hex numbers", () => {
    const t = tokens("(color 0xFF)");
    expect(t[2]!.type).toBe(Token.NUMBER);
    expect(t[2]!.value).toBe(255);
  });

  it("tokenizes atoms with special chars", () => {
    const t = tokens("(net_name +3V3)");
    expect(t[2]!.type).toBe(Token.ATOM);
    expect(t[2]!.value).toBe("+3V3");
  });

  it("tokenizes nested expressions", () => {
    const t = tokens("(a (b 1) (c 2))");
    expect(t.map((tok) => tok.type)).toEqual([
      Token.OPEN, Token.ATOM,
      Token.OPEN, Token.ATOM, Token.NUMBER, Token.CLOSE,
      Token.OPEN, Token.ATOM, Token.NUMBER, Token.CLOSE,
      Token.CLOSE,
    ]);
  });

  it("handles whitespace variants", () => {
    const t = tokens("(\t\n  atom  \r\n)");
    expect(t).toHaveLength(3);
    expect(t[1]!.value).toBe("atom");
  });

  it("throws on unexpected characters", () => {
    expect(() => tokens("(^bad)")).toThrow();
  });

  it("tokenizes empty string to no tokens", () => {
    expect(tokens("")).toHaveLength(0);
  });
});

describe("listify", () => {
  it("converts simple expression to nested arrays", () => {
    const result = listify("(kicad_pcb (version 20240108))");
    expect(result).toEqual([["kicad_pcb", ["version", 20240108]]]);
  });

  it("converts multiple children", () => {
    const result = listify("(a (b 1) (c 2))");
    expect(result).toEqual([["a", ["b", 1], ["c", 2]]]);
  });

  it("handles strings in lists", () => {
    const result = listify('(name "test board")');
    expect(result).toEqual([["name", "test board"]]);
  });

  it("handles deeply nested structures", () => {
    const result = listify("(a (b (c (d 1))))");
    expect(result).toEqual([["a", ["b", ["c", ["d", 1]]]]]);
  });
});

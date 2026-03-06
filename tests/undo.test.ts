import { describe, it, expect } from "vitest";
import { UndoStack, ChangeType } from "../src/editor/undo";
import { SchLine, SchJunction } from "../src/editor/items";
import { vec2 } from "../src/editor/types";

function makeStack() {
  return new UndoStack();
}

describe("UndoStack", () => {
  it("starts empty", () => {
    const s = makeStack();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });

  it("pushes a transaction", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line, ChangeType.ADD);
    s.push("Add wire", () => {});
    expect(s.canUndo).toBe(true);
    expect(s.undoDescription).toBe("Add wire");
  });

  it("ignores push with no staged changes", () => {
    const s = makeStack();
    s.push("Empty", () => {});
    expect(s.canUndo).toBe(false);
  });

  it("undoes ADD by calling removeFn", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line, ChangeType.ADD);
    s.push("Add wire", () => {});

    const removed: any[] = [];
    const desc = s.undo(
      () => {},
      (item) => removed.push(item),
      () => {},
    );

    expect(desc).toBe("Add wire");
    expect(removed).toContain(line);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
  });

  it("undoes REMOVE by calling addFn", () => {
    const s = makeStack();
    const junction = new SchJunction(vec2(5, 5));
    s.stage(junction, ChangeType.REMOVE);
    s.push("Delete junction", () => {});

    const added: any[] = [];
    s.undo(
      (item) => added.push(item),
      () => {},
      () => {},
    );

    expect(added).toContain(junction);
  });

  it("undoes MODIFY by swapping snapshots", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));

    // Stage captures a snapshot of the current state
    s.stage(line, ChangeType.MODIFY);

    // Simulate modification after staging
    line.start = vec2(5, 5);

    s.push("Move wire", () => {});

    const restored: any[] = [];
    s.undo(
      () => {},
      () => {},
      (item, snapshot) => restored.push({ item, snapshot }),
    );

    expect(restored).toHaveLength(1);
    // Snapshot should have the original position
    expect(restored[0]!.snapshot.start).toEqual({ x: 0, y: 0 });
  });

  it("redo re-applies changes", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line, ChangeType.ADD);
    s.push("Add wire", () => {});

    s.undo(
      () => {},
      () => {},
      () => {},
    );

    const added: any[] = [];
    const desc = s.redo(
      (item) => added.push(item),
      () => {},
      () => {},
    );

    expect(desc).toBe("Add wire");
    expect(added).toContain(line);
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
  });

  it("new push clears redo stack", () => {
    const s = makeStack();
    const line1 = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line1, ChangeType.ADD);
    s.push("First", () => {});

    s.undo(
      () => {},
      () => {},
      () => {},
    );
    expect(s.canRedo).toBe(true);

    const line2 = new SchLine(vec2(0, 0), vec2(5, 5));
    s.stage(line2, ChangeType.ADD);
    s.push("Second", () => {});

    expect(s.canRedo).toBe(false);
  });

  it("revert clears staged changes", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line, ChangeType.ADD);
    s.revert();
    s.push("Should be empty", () => {});
    expect(s.canUndo).toBe(false);
  });

  it("clear resets everything", () => {
    const s = makeStack();
    const line = new SchLine(vec2(0, 0), vec2(10, 0));
    s.stage(line, ChangeType.ADD);
    s.push("Add", () => {});
    s.clear();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });

  it("respects max size limit", () => {
    const s = makeStack();
    for (let i = 0; i < 150; i++) {
      s.stage(new SchLine(vec2(0, 0), vec2(i, 0)), ChangeType.ADD);
      s.push(`Action ${i}`, () => {});
    }
    // Should be capped at 100
    let count = 0;
    while (s.canUndo) {
      s.undo(
        () => {},
        () => {},
        () => {},
      );
      count++;
    }
    expect(count).toBe(100);
  });

  it("undoes multiple changes in reverse order", () => {
    const s = makeStack();
    const line1 = new SchLine(vec2(0, 0), vec2(10, 0));
    const line2 = new SchLine(vec2(0, 0), vec2(0, 10));
    s.stage(line1, ChangeType.ADD);
    s.stage(line2, ChangeType.ADD);
    s.push("Add two wires", () => {});

    const removed: any[] = [];
    s.undo(
      () => {},
      (item) => removed.push(item),
      () => {},
    );

    // Should be reversed: line2 first, then line1
    expect(removed[0]).toBe(line2);
    expect(removed[1]).toBe(line1);
  });

  it("returns null when nothing to undo/redo", () => {
    const s = makeStack();
    expect(
      s.undo(
        () => {},
        () => {},
        () => {},
      ),
    ).toBeNull();
    expect(
      s.redo(
        () => {},
        () => {},
        () => {},
      ),
    ).toBeNull();
  });
});

// Transaction-based undo/redo system - mirrors KiCad's SCH_COMMIT pattern

// Works with any item that has uuid, clone(), move(), rotate(), mirrorH(), mirrorV()
// Compatible with both SchItem (legacy) and EditableItem (kicanvas)
export interface UndoableItem {
  uuid?: string;
  id?: string;
  clone(): UndoableItem;
}

export enum ChangeType {
  ADD = "add",
  REMOVE = "remove",
  MODIFY = "modify",
}

interface Change {
  type: ChangeType;
  item: UndoableItem;
  snapshot?: UndoableItem; // Clone of item before modification (for MODIFY)
}

interface Transaction {
  description: string;
  changes: Change[];
}

export class UndoStack {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private stagedChanges: Change[] = [];
  private maxSize = 100;

  stage(item: UndoableItem, type: ChangeType): void {
    const change: Change = { type, item };

    if (type === ChangeType.MODIFY) {
      change.snapshot = item.clone();
    }

    this.stagedChanges.push(change);
  }

  push(description: string, applyFn: (changes: Change[]) => void): void {
    if (this.stagedChanges.length === 0) return;

    const tx: Transaction = {
      description,
      changes: [...this.stagedChanges],
    };

    this.undoStack.push(tx);
    this.redoStack = []; // Clear redo on new action

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    this.stagedChanges = [];
  }

  revert(): void {
    this.stagedChanges = [];
  }

  undo(
    addFn: (item: UndoableItem) => void,
    removeFn: (item: UndoableItem) => void,
    restoreFn: (item: UndoableItem, snapshot: UndoableItem) => void,
  ): string | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;

    // Apply changes in reverse order
    for (let i = tx.changes.length - 1; i >= 0; i--) {
      const change = tx.changes[i]!;
      switch (change.type) {
        case ChangeType.ADD:
          removeFn(change.item);
          break;
        case ChangeType.REMOVE:
          addFn(change.item);
          break;
        case ChangeType.MODIFY:
          if (change.snapshot) {
            // Swap current state with snapshot for redo
            const currentSnapshot = change.item.clone();
            restoreFn(change.item, change.snapshot);
            change.snapshot = currentSnapshot;
          }
          break;
      }
    }

    this.redoStack.push(tx);
    return tx.description;
  }

  redo(
    addFn: (item: UndoableItem) => void,
    removeFn: (item: UndoableItem) => void,
    restoreFn: (item: UndoableItem, snapshot: UndoableItem) => void,
  ): string | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;

    for (const change of tx.changes) {
      switch (change.type) {
        case ChangeType.ADD:
          addFn(change.item);
          break;
        case ChangeType.REMOVE:
          removeFn(change.item);
          break;
        case ChangeType.MODIFY:
          if (change.snapshot) {
            const currentSnapshot = change.item.clone();
            restoreFn(change.item, change.snapshot);
            change.snapshot = currentSnapshot;
          }
          break;
      }
    }

    this.undoStack.push(tx);
    return tx.description;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDescription(): string | null {
    return this.undoStack.at(-1)?.description ?? null;
  }

  get redoDescription(): string | null {
    return this.redoStack.at(-1)?.description ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.stagedChanges = [];
  }
}

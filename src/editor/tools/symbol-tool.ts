import { BaseTool } from "./base-tool";
import { ToolType, type ToolEvent } from "../tool-types";
import { SchSymbol } from "../items";
import type { ISymbolLibrary } from "../types";

export class SymbolTool extends BaseTool {
  readonly type = ToolType.SYMBOL;
  symLibrary: ISymbolLibrary | null = null;

  async handleEvent(evt: ToolEvent): Promise<void> {
    if (evt.type !== "mousedown" && evt.type !== "click") return;

    const libId = await this.ctx.callbacks.requestSymbolChooser();
    if (!libId) return;

    const symbol = new SchSymbol(evt.pos, libId);

    if (this.symLibrary) {
      const libSym = this.symLibrary.findLibSymbol(libId);
      if (libSym) {
        symbol.libSymbol = libSym;
        const allPins = [...(libSym.pins ?? [])];
        for (const child of libSym.children ?? []) {
          allPins.push(...(child.pins ?? []));
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
    }

    this.ctx.doc.commitAdd(symbol, "Place symbol");
    this.ctx.callbacks.requestRedraw();
  }
}

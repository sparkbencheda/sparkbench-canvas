// Polyfill window for KiCanvas logger which uses window.console
import { vi } from "vitest";

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = { console: globalThis.console };
}

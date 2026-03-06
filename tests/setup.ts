// Polyfill window for vendor-kicanvas Logger which uses window.console
import { vi } from "vitest";

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = { console: globalThis.console };
}

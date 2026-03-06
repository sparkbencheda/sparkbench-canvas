// Build the editor overlay as a standalone bundle for Playwright testing
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/e2e/harness-entry.ts"],
  bundle: true,
  outfile: "tests/e2e/dist/harness.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  loader: {
    ".css": "text",
    ".kicad_wks": "text",
    ".glsl": "text",
    ".svg": "text",
  },
});
console.log("Harness built.");

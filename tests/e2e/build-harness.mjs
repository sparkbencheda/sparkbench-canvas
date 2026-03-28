// Build the editor harness as standalone bundles for Playwright testing
import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const distDir = "tests/e2e/dist";
fs.mkdirSync(distDir, { recursive: true });

// Copy HTML files to dist
for (const html of ["harness.html", "unified-harness.html"]) {
  const src = path.join("tests/e2e", html);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, html));
  }
}

// Build standalone harness (no viewer, tests tool/doc logic only)
await esbuild.build({
  entryPoints: ["tests/e2e/harness-entry.ts"],
  bundle: true,
  outfile: path.join(distDir, "harness.js"),
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

// Build unified harness (loads real .kicad_sch, tests full rendering pipeline)
const unifiedEntry = "tests/e2e/unified-harness-entry.ts";
if (fs.existsSync(unifiedEntry)) {
  await esbuild.build({
    entryPoints: [unifiedEntry],
    bundle: true,
    outfile: path.join(distDir, "unified-harness.js"),
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    loader: {
      ".css": "text",
      ".kicad_wks": "text",
      ".kicad_sch": "text",
      ".glsl": "text",
      ".svg": "text",
    },
  });
}

console.log("Harnesses built.");

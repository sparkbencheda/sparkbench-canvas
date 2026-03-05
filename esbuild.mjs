import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

// Bundle the extension (Node.js, runs in VS Code extension host)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
};

// Bundle the webview (browser, runs in VS Code webview)
// kicanvas imports .css files as text strings for web component shadow DOM
const webviewConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview.js",
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
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

if (watch) {
  const extCtx = await esbuild.context(extensionConfig);
  const webCtx = await esbuild.context(webviewConfig);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
  console.log("Build complete.");
}

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

// Shared webview config
const webviewBase = {
  bundle: true,
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

// Bundle the webview (browser, runs in VS Code webview)
// kicanvas imports .css files as text strings for web component shadow DOM
const webviewConfig = {
  ...webviewBase,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
};

// Bundle the project dashboard webview
const projectWebviewConfig = {
  ...webviewBase,
  entryPoints: ["src/webview/project-main.ts"],
  outfile: "dist/project-webview.js",
};

if (watch) {
  const extCtx = await esbuild.context(extensionConfig);
  const webCtx = await esbuild.context(webviewConfig);
  const projCtx = await esbuild.context(projectWebviewConfig);
  await Promise.all([extCtx.watch(), webCtx.watch(), projCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(projectWebviewConfig),
  ]);
  console.log("Build complete.");
}

import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    KicadEditorProvider.register(context, "sparkbench.kicadPcb", "pcb"),
    KicadEditorProvider.register(context, "sparkbench.kicadSch", "schematic"),
  );
}

export function deactivate() {}

// File extensions we care about for project loading
const PROJECT_EXTENSIONS = [
  ".kicad_pcb",
  ".kicad_sch",
  ".kicad_pro",
];

class KicadEditorProvider implements vscode.CustomReadonlyEditorProvider {
  private readonly viewType: string;
  private readonly fileType: "pcb" | "schematic";

  static register(
    context: vscode.ExtensionContext,
    viewType: string,
    fileType: "pcb" | "schematic",
  ): vscode.Disposable {
    const provider = new KicadEditorProvider(context, viewType, fileType);
    return vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    viewType: string,
    fileType: "pcb" | "schematic",
  ) {
    this.viewType = viewType;
    this.fileType = fileType;
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  /**
   * Scan the project directory for all related KiCad files.
   * Returns a map of filename -> content for the webview.
   */
  private async gatherProjectFiles(
    documentUri: vscode.Uri,
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const dir = vscode.Uri.joinPath(documentUri, "..");

    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);

      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) continue;

        const isProjectFile = PROJECT_EXTENSIONS.some((ext) =>
          name.endsWith(ext),
        );
        if (!isProjectFile) continue;

        try {
          const fileUri = vscode.Uri.joinPath(dir, name);
          const content = await vscode.workspace.fs.readFile(fileUri);
          files[name] = Buffer.from(content).toString("utf-8");
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // If we can't read the directory, just use the single file
    }

    return files;
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };

    const fileContent = await vscode.workspace.fs.readFile(document.uri);
    const text = Buffer.from(fileContent).toString("utf-8");
    const fileName = document.uri.path.split("/").pop() || "unknown";

    // Gather all project files in the same directory
    const projectFiles = await this.gatherProjectFiles(document.uri);

    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      text,
      fileName,
      projectFiles,
    );

    // Watch for file changes
    const dir = vscode.Uri.joinPath(document.uri, "..");
    const pattern = new vscode.RelativePattern(dir, "*.kicad_*");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const refresh = async () => {
      const updated = await vscode.workspace.fs.readFile(document.uri);
      const updatedFiles = await this.gatherProjectFiles(document.uri);
      webviewPanel.webview.postMessage({
        type: "update",
        content: Buffer.from(updated).toString("utf-8"),
        fileName,
        projectFiles: updatedFiles,
      });
    };

    watcher.onDidChange(refresh);
    webviewPanel.onDidDispose(() => watcher.dispose());
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    content: string,
    fileName: string,
    projectFiles: Record<string, string>,
  ): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );

    const nonce = getNonce();
    const isPcb = this.fileType === "pcb";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src ${webview.cspSource} data: blob:;">
  <style>
    :root {
      --bg: #1e1e1e; --bg-raised: #252526; --bg-hover: #2a2d2e;
      --bg-active: #37373d; --border: #3c3c3c;
      --fg: #cccccc; --fg-dim: #858585; --fg-bright: #e0e0e0;
      --accent: #0078d4; --accent-hover: #1c8ae8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; font-size: 12px; }
    #app { display: flex; width: 100%; height: 100%; }

    #main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

    #top-toolbar {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px; background: var(--bg-raised); border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    #top-toolbar .filename { font-weight: 600; color: var(--fg-bright); margin-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #page-selector { background: var(--bg-active); color: var(--fg); border: 1px solid var(--border); padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: auto; }
    .toolbar-btn {
      background: none; border: 1px solid transparent; color: var(--fg); padding: 4px 8px;
      border-radius: 3px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px; white-space: nowrap;
    }
    .toolbar-btn:hover { background: var(--bg-hover); border-color: var(--border); }
    .toolbar-btn:active { background: var(--bg-active); }
    .toolbar-btn.active { background: var(--accent); color: white; }
    .toolbar-btn:disabled { opacity: 0.4; cursor: default; }
    .toolbar-sep { width: 1px; height: 18px; background: var(--border); }

    #editor-toolbar {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 8px; background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    #editor-toolbar .etool.active { background: var(--accent); color: white; }
    #canvas-container { flex: 1; position: relative; overflow: hidden; }
    #canvas-container canvas { width: 100%; height: 100%; display: block; }

    #bottom-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 2px 8px; background: var(--bg-raised); border-top: 1px solid var(--border); flex-shrink: 0; height: 24px;
    }
    #mouse-pos { color: var(--fg-dim); font-family: monospace; font-size: 11px; }
    #bottom-toolbar .zoom-btns { display: flex; gap: 4px; }
    .zoom-btn { background: none; border: none; color: var(--fg-dim); cursor: pointer; padding: 0 4px; font-size: 11px; }
    .zoom-btn:hover { color: var(--fg-bright); }

    #sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-raised); border-left: 1px solid var(--border); }
    #sidebar.collapsed { width: 0; overflow: hidden; border-left: none; }

    #tab-bar {
      display: flex; background: var(--bg); border-bottom: 1px solid var(--border); overflow-x: auto; flex-shrink: 0;
    }
    .tab {
      padding: 6px 10px; cursor: pointer; border-bottom: 2px solid transparent;
      color: var(--fg-dim); white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .tab:hover { color: var(--fg); background: var(--bg-hover); }
    .tab.active { color: var(--fg-bright); border-bottom-color: var(--accent); }

    #sidebar-content { flex: 1; overflow-y: auto; padding: 0; }

    .panel { display: none; }
    .panel.active { display: block; }
    .panel-section { padding: 8px; border-bottom: 1px solid var(--border); }
    .panel-section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-dim); margin-bottom: 6px; font-weight: 600; }

    .layer-item { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 3px; cursor: pointer; }
    .layer-item:hover { background: var(--bg-hover); }
    .layer-item.highlighted { background: var(--bg-active); }
    .layer-color { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15); }
    .layer-name { flex: 1; font-size: 11px; }
    .layer-vis { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; opacity: 0.6; font-size: 10px; }
    .layer-vis.hidden { opacity: 0.2; }

    .list-item { padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 11px; }
    .list-item:hover { background: var(--bg-hover); }
    .list-item.selected { background: var(--bg-active); color: var(--fg-bright); }

    .prop-row { display: flex; padding: 3px 0; font-size: 11px; }
    .prop-label { color: var(--fg-dim); width: 80px; flex-shrink: 0; }
    .prop-value { color: var(--fg-bright); word-break: break-all; }

    .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 11px; }
    .info-grid dt { color: var(--fg-dim); }
    .info-grid dd { color: var(--fg-bright); }

    #loading-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); z-index: 10; }
    #loading-overlay.hidden { display: none; }
    #loading-text { color: var(--fg-dim); font-size: 13px; }

    #resizer { width: 4px; cursor: col-resize; background: transparent; flex-shrink: 0; }
    #resizer:hover { background: var(--accent); }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--fg-dim); }
  </style>
</head>
<body>
  <div id="app">
    <div id="main">
      <div id="top-toolbar">
        <span class="filename">${escapeHtml(fileName)}</span>
        <select id="page-selector" style="display:none"></select>
        <div style="flex:1"></div>
        ${isPcb ? '<button class="toolbar-btn" id="btn-flip" title="Flip board view">Flip</button>' : ""}
        <button class="toolbar-btn" id="btn-zoom-fit" title="Zoom to fit">Fit</button>
        <button class="toolbar-btn" id="btn-zoom-sel" title="Zoom to selection" disabled>Selection</button>
        ${!isPcb ? `<div class="toolbar-sep"></div>
        <button class="toolbar-btn" id="btn-edit-mode" title="Toggle editor overlay (E)">Edit</button>` : ""}
        <div class="toolbar-sep"></div>
        <button class="toolbar-btn" id="btn-sidebar-toggle" title="Toggle sidebar">Panel</button>
      </div>
      <div id="editor-toolbar" style="display:none">
        <button class="toolbar-btn etool active" data-tool="select" title="Select (Esc)">Select</button>
        <button class="toolbar-btn etool" data-tool="wire" title="Wire (W)">Wire</button>
        <button class="toolbar-btn etool" data-tool="bus" title="Bus (B)">Bus</button>
        <button class="toolbar-btn etool" data-tool="symbol" title="Symbol (A)">Symbol</button>
        <button class="toolbar-btn etool" data-tool="label" title="Label (L)">Label</button>
        <button class="toolbar-btn etool" data-tool="global_label" title="Global Label">GLabel</button>
        <button class="toolbar-btn etool" data-tool="junction" title="Junction (J)">Junction</button>
        <button class="toolbar-btn etool" data-tool="no_connect" title="No Connect (Q)">NoConn</button>
        <div class="toolbar-sep"></div>
        <button class="toolbar-btn" id="btn-undo" title="Undo (Ctrl+Z)">Undo</button>
        <button class="toolbar-btn" id="btn-redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
        <div class="toolbar-sep"></div>
        <span id="editor-status" style="color:var(--fg-dim);padding:0 8px"></span>
      </div>
      <div id="canvas-container">
        <div id="loading-overlay"><span id="loading-text">Loading...</span></div>
      </div>
      <div id="bottom-toolbar">
        <span id="mouse-pos">X: 0.00 Y: 0.00 mm</span>
        <div class="zoom-btns">
          <button class="zoom-btn" id="btn-zoom-in" title="Zoom in">+</button>
          <button class="zoom-btn" id="btn-zoom-out" title="Zoom out">-</button>
        </div>
      </div>
    </div>
    <div id="resizer"></div>
    <div id="sidebar">
      <div id="tab-bar"></div>
      <div id="sidebar-content"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    window.__KICAD_FILE_CONTENT__ = ${JSON.stringify(escapeHtml(content))};
    window.__KICAD_FILE_NAME__ = ${JSON.stringify(fileName)};
    window.__KICAD_FILE_TYPE__ = ${JSON.stringify(this.fileType)};
    window.__KICAD_PROJECT_FILES__ = ${JSON.stringify(projectFiles)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

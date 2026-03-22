import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    KicadEditorProvider.register(context, "sparkbench.kicadPcb", "pcb"),
    KicadEditorProvider.register(context, "sparkbench.kicadSch", "schematic"),
    KicadEditorProvider.register(context, "sparkbench.kicadPro", "project"),
  );
}

export function deactivate() {}

// ==================== KiCad Library System ====================
// Mirrors KiCad's sym-lib-table architecture:
// 1. Global sym-lib-table in user config dir (can reference nested Table entries)
// 2. Project sym-lib-table in project dir (uses ${KIPRJMOD})
// 3. Libraries resolved via env vars (${KICAD10_SYMBOL_DIR}, etc.)
// 4. Project libs override global libs with same name

interface LibTableEntry {
  name: string;
  type: string;     // "KiCad" or "Table" (nested reference)
  uri: string;       // File path (may contain env vars)
  descr: string;
}

interface GlobalLibraryIndex {
  libraries: { name: string; filePath: string; symbolNames: string[]; descr: string }[];
  /** Map of library name → resolved file path for on-demand loading */
  pathMap: Record<string, string>;
}

// KiCad config directory locations per platform
const KICAD_CONFIG_DIRS = [
  // macOS
  path.join(process.env.HOME ?? "", "Library/Preferences/kicad"),
  // Linux
  path.join(process.env.HOME ?? "", ".config/kicad"),
  // Windows
  path.join(process.env.APPDATA ?? "", "kicad"),
];

// KiCad shared support locations (for resolving ${KICADxx_SYMBOL_DIR})
const KICAD_SHARED_DIRS = [
  "/Applications/KiCad/KiCad.app/Contents/SharedSupport",
  "/usr/share/kicad",
  "/usr/local/share/kicad",
  "C:\\Program Files\\KiCad\\8.0\\share\\kicad",
  "C:\\Program Files\\KiCad\\9.0\\share\\kicad",
  "C:\\Program Files\\KiCad\\10.0\\share\\kicad",
];

/** Find the KiCad shared support directory */
function findKicadSharedDir(): string | null {
  for (const dir of KICAD_SHARED_DIRS) {
    if (fs.existsSync(path.join(dir, "symbols"))) return dir;
  }
  return null;
}

/** Find the user's global sym-lib-table file */
function findGlobalSymLibTable(): string | null {
  for (const configDir of KICAD_CONFIG_DIRS) {
    if (!fs.existsSync(configDir)) continue;
    // Scan for versioned subdirs (e.g., 10.0, 9.0, 8.0)
    try {
      const versions = fs.readdirSync(configDir)
        .filter(d => /^\d+\.\d+$/.test(d))
        .sort((a, b) => parseFloat(b) - parseFloat(a)); // newest first
      for (const ver of versions) {
        const tablePath = path.join(configDir, ver, "sym-lib-table");
        if (fs.existsSync(tablePath)) return tablePath;
      }
    } catch { /* skip */ }
  }
  return null;
}

/** Parse a sym-lib-table file into entries */
function parseSymLibTableFile(content: string): LibTableEntry[] {
  const entries: LibTableEntry[] = [];
  const regex = /\(lib\s+\(name\s+"([^"]+)"\)\s*\(type\s+"([^"]+)"\)\s*\(uri\s+"([^"]+)"\)\s*\(options\s+"[^"]*"\)\s*\(descr\s+"([^"]*)"\)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    entries.push({
      name: match[1]!,
      type: match[2]!,
      uri: match[3]!,
      descr: match[4]!,
    });
  }
  return entries;
}

/** Resolve env vars in a KiCad URI */
function resolveKicadUri(uri: string, sharedDir: string | null, projectDir?: string): string {
  let resolved = uri;
  // Resolve ${KICADxx_SYMBOL_DIR} variants
  resolved = resolved.replace(/\$\{KICAD\d+_SYMBOL_DIR\}/g, sharedDir ? path.join(sharedDir, "symbols") : "");
  // Resolve ${KIPRJMOD}
  if (projectDir) {
    resolved = resolved.replace(/\$\{KIPRJMOD\}/g, projectDir);
  }
  return resolved;
}

/** Recursively collect all library entries from a sym-lib-table (follows Table references) */
function collectLibEntries(tablePath: string, sharedDir: string | null): LibTableEntry[] {
  try {
    const content = fs.readFileSync(tablePath, "utf-8");
    const entries = parseSymLibTableFile(content);
    const result: LibTableEntry[] = [];

    for (const entry of entries) {
      if (entry.type === "Table") {
        // Nested table reference — resolve and recurse
        const nestedPath = resolveKicadUri(entry.uri, sharedDir);
        if (fs.existsSync(nestedPath)) {
          result.push(...collectLibEntries(nestedPath, sharedDir));
        }
      } else {
        result.push(entry);
      }
    }
    return result;
  } catch {
    return [];
  }
}

/** Extract top-level symbol names from a .kicad_sym file without full parsing */
function extractSymbolNames(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const names: string[] = [];
    const regex = /^[\t ]{1,2}\(symbol\s+"([^"]+)"/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]!;
      // Skip sub-unit symbols (contain _N_ patterns like Foo_1_1)
      if (!/_\d+_/.test(name)) {
        names.push(name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Build the global library index by reading sym-lib-table chain */
function buildGlobalLibraryIndex(): GlobalLibraryIndex | null {
  const config = vscode.workspace.getConfiguration("sparkbench");
  const customPath = config.get<string>("kicadLibraryPath", "");

  const sharedDir = findKicadSharedDir();
  const pathMap: Record<string, string> = {};
  const libraries: GlobalLibraryIndex["libraries"] = [];

  let entries: LibTableEntry[] = [];

  if (customPath && fs.existsSync(customPath)) {
    // Manual override: treat as a directory of .kicad_sym files
    const files = fs.readdirSync(customPath).filter(f => f.endsWith(".kicad_sym"));
    entries = files.map(f => ({
      name: f.replace(".kicad_sym", ""),
      type: "KiCad",
      uri: path.join(customPath, f),
      descr: "",
    }));
  } else {
    // Auto-detect: read the global sym-lib-table
    const globalTable = findGlobalSymLibTable();
    if (!globalTable) return null;
    entries = collectLibEntries(globalTable, sharedDir);
  }

  for (const entry of entries) {
    if (entry.type !== "KiCad") continue;
    const resolvedPath = resolveKicadUri(entry.uri, sharedDir);
    if (!fs.existsSync(resolvedPath)) continue;

    const symbolNames = extractSymbolNames(resolvedPath);
    if (symbolNames.length > 0) {
      libraries.push({
        name: entry.name,
        filePath: resolvedPath,
        symbolNames,
        descr: entry.descr,
      });
      pathMap[entry.name] = resolvedPath;
    }
  }

  if (libraries.length === 0) return null;
  return { libraries, pathMap };
}

/** Read a single library file by name using the index's path map */
function readLibraryFile(index: GlobalLibraryIndex, libraryName: string): string | null {
  const filePath = index.pathMap[libraryName];
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

let cachedGlobalIndex: GlobalLibraryIndex | null = null;

// File extensions we care about for project loading
const PROJECT_EXTENSIONS = [
  ".kicad_pcb",
  ".kicad_sch",
  ".kicad_pro",
  ".kicad_sym",
];

const PROJECT_EXACT_NAMES = ["sym-lib-table", "fp-lib-table"];

class KicadDocument implements vscode.CustomDocument {
  uri: vscode.Uri;
  private _isDirty = false;
  private _onDidDispose = new vscode.EventEmitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  private _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<KicadDocument>>();
  readonly onDidChange = this._onDidChange.event;

  // Pending save content from the webview
  pendingSaveContent: string | null = null;
  private _saveResolve: ((content: string) => void) | null = null;

  constructor(uri: vscode.Uri) {
    this.uri = uri;
  }

  get isDirty() { return this._isDirty; }

  markDirty() {
    if (!this._isDirty) {
      this._isDirty = true;
      this._onDidChange.fire({
        document: this,
        undo: () => {},
        redo: () => {},
      });
    }
  }

  markClean() {
    this._isDirty = false;
  }

  /** Called when webview responds with serialized content for save */
  resolveSave(content: string) {
    if (this._saveResolve) {
      this._saveResolve(content);
      this._saveResolve = null;
    }
  }

  /** Wait for webview to provide content for save */
  waitForSaveContent(): Promise<string> {
    return new Promise((resolve) => {
      this._saveResolve = resolve;
    });
  }

  dispose(): void {
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
    this._onDidChange.dispose();
  }
}

class KicadEditorProvider implements vscode.CustomEditorProvider<KicadDocument> {
  private readonly viewType: string;
  private readonly fileType: "pcb" | "schematic" | "project";
  private readonly documents = new Map<string, KicadDocument>();
  private readonly webviews = new Map<string, vscode.WebviewPanel>();

  private _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<KicadDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  static register(
    context: vscode.ExtensionContext,
    viewType: string,
    fileType: "pcb" | "schematic" | "project",
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
    fileType: "pcb" | "schematic" | "project",
  ) {
    this.viewType = viewType;
    this.fileType = fileType;
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<KicadDocument> {
    const doc = new KicadDocument(uri);
    this.documents.set(uri.toString(), doc);
    doc.onDidDispose(() => this.documents.delete(uri.toString()));
    doc.onDidChange((e) => this._onDidChangeCustomDocument.fire(e));
    return doc;
  }

  async saveCustomDocument(document: KicadDocument, _cancellation: vscode.CancellationToken): Promise<void> {
    const panel = this.webviews.get(document.uri.toString());
    if (!panel) return;

    // Request content from webview
    panel.webview.postMessage({ type: "requestSave" });
    const content = await document.waitForSaveContent();

    await vscode.workspace.fs.writeFile(
      document.uri,
      Buffer.from(content, "utf-8"),
    );
    document.markClean();
  }

  async saveCustomDocumentAs(document: KicadDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
    const panel = this.webviews.get(document.uri.toString());
    if (!panel) return;

    panel.webview.postMessage({ type: "requestSave" });
    const content = await document.waitForSaveContent();

    await vscode.workspace.fs.writeFile(
      destination,
      Buffer.from(content, "utf-8"),
    );
    document.markClean();
  }

  async revertCustomDocument(document: KicadDocument, _cancellation: vscode.CancellationToken): Promise<void> {
    const panel = this.webviews.get(document.uri.toString());
    if (!panel) return;

    const updated = await vscode.workspace.fs.readFile(document.uri);
    const fileName = document.uri.path.split("/").pop() || "unknown";
    const updatedFiles = await this.gatherProjectFiles(document.uri);
    panel.webview.postMessage({
      type: "update",
      content: Buffer.from(updated).toString("utf-8"),
      fileName,
      projectFiles: updatedFiles,
    });
    document.markClean();
  }

  async backupCustomDocument(document: KicadDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    return {
      id: context.destination.toString(),
      delete: () => {},
    };
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
        ) || PROJECT_EXACT_NAMES.includes(name);
        if (!isProjectFile) continue;

        try {
          const fileUri = vscode.Uri.joinPath(dir, name);
          const content = await vscode.workspace.fs.readFile(fileUri);
          files[name] = Buffer.from(content).toString("utf-8");
        } catch (e) {
          console.warn(`Failed to read project file ${name}:`, e);
        }
      }
    } catch (e) {
      console.warn(`Failed to read project directory:`, e);
    }

    return files;
  }

  async resolveCustomEditor(
    document: KicadDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.webviews.set(document.uri.toString(), webviewPanel);

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

    // Send global library index if enabled
    const config = vscode.workspace.getConfiguration("sparkbench");
    if (config.get<boolean>("useSystemKicadLibraries", true)) {
      if (!cachedGlobalIndex) {
        cachedGlobalIndex = buildGlobalLibraryIndex();
      }
      if (cachedGlobalIndex) {
        webviewPanel.webview.postMessage({
          type: "globalLibraryIndex",
          index: {
            libraries: cachedGlobalIndex.libraries.map(l => ({
              name: l.name,
              symbolNames: l.symbolNames,
              descr: l.descr,
            })),
          },
        });
      }
    }

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "openFile") {
        const dir = vscode.Uri.joinPath(document.uri, "..");
        const fileUri = vscode.Uri.joinPath(dir, msg.fileName);
        try {
          await vscode.commands.executeCommand("vscode.openWith", fileUri);
        } catch {
          await vscode.commands.executeCommand("vscode.open", fileUri);
        }
      }
      if (msg.type === "dirty") {
        document.markDirty();
      }
      if (msg.type === "saveContent") {
        document.resolveSave(msg.content);
      }
      if (msg.type === "requestLibrary") {
        // On-demand: webview requests full content of a specific library
        if (cachedGlobalIndex) {
          const content = readLibraryFile(cachedGlobalIndex, msg.libraryName);
          if (content) {
            webviewPanel.webview.postMessage({
              type: "libraryContent",
              libraryName: msg.libraryName,
              content,
            });
          }
        }
      }
    });

    // Watch for file changes (only refresh if doc is not dirty)
    const dir = vscode.Uri.joinPath(document.uri, "..");
    const pattern = new vscode.RelativePattern(dir, "*.kicad_*");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const refresh = async () => {
      if (document.isDirty) return; // Don't overwrite unsaved changes
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
    webviewPanel.onDidDispose(() => {
      watcher.dispose();
      this.webviews.delete(document.uri.toString());
    });
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    content: string,
    fileName: string,
    projectFiles: Record<string, string>,
  ): string {
    const nonce = getNonce();

    if (this.fileType === "project") {
      const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "project-webview.js"),
      );
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; style-src 'unsafe-inline'; font-src data:;">
  <style>
    :root {
      --bg: #1e1e1e; --bg-raised: #252526; --bg-hover: #2a2d2e;
      --bg-active: #37373d; --border: #3c3c3c;
      --fg: #cccccc; --fg-dim: #858585; --fg-bright: #e0e0e0;
      --accent: #0078d4; --accent-hover: #1c8ae8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow-y: auto; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }
    #dashboard { max-width: 900px; margin: 0 auto; padding: 24px; }
    h1 { color: var(--fg-bright); font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: var(--fg-dim); font-size: 12px; margin-bottom: 20px; }
    .card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-bottom: 12px; }
    .card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-dim); margin-bottom: 10px; font-weight: 600; }
    .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .kv { display: flex; gap: 8px; font-size: 12px; padding: 2px 0; }
    .kv-label { color: var(--fg-dim); min-width: 100px; }
    .kv-value { color: var(--fg-bright); word-break: break-all; }
    .file-link { color: var(--accent); cursor: pointer; padding: 4px 8px; border-radius: 3px; font-size: 12px; display: inline-block; }
    .file-link:hover { background: var(--bg-hover); color: var(--accent-hover); text-decoration: underline; }
    .lib-item { padding: 4px 8px; border-radius: 3px; font-size: 12px; display: flex; justify-content: space-between; }
    .lib-item:nth-child(even) { background: var(--bg-hover); }
    .lib-name { color: var(--fg-bright); }
    .lib-detail { color: var(--fg-dim); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; color: var(--fg-dim); padding: 4px 8px; border-bottom: 1px solid var(--border); font-weight: 600; }
    td { padding: 4px 8px; border-bottom: 1px solid var(--border); color: var(--fg-bright); }
    tr:hover { background: var(--bg-hover); }
  </style>
</head>
<body>
  <div id="dashboard"></div>
  <script nonce="${nonce}">
    window.__KICAD_FILE_CONTENT__ = ${JSON.stringify(content)};
    window.__KICAD_FILE_NAME__ = ${JSON.stringify(fileName)};
    window.__KICAD_PROJECT_FILES__ = ${JSON.stringify(projectFiles)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );

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

import { KicadPCB, KicadSch } from "../../vendor-kicanvas/src/kicad";
import { Footprint } from "../../vendor-kicanvas/src/kicad/board";
import { SchematicSymbol } from "../../vendor-kicanvas/src/kicad/schematic";
import { BoardViewer } from "../../vendor-kicanvas/src/viewers/board/viewer";
import { SchematicViewer } from "../../vendor-kicanvas/src/viewers/schematic/viewer";
import { Project, ProjectPage } from "../../vendor-kicanvas/src/kicanvas/project";
import { LocalFileSystem } from "../../vendor-kicanvas/src/kicanvas/services/vfs";
import themes from "../../vendor-kicanvas/src/kicanvas/themes/index";
import { EditorOverlay } from "./editor-overlay";
import { ToolType } from "../editor/tools";

declare global {
  interface Window {
    __KICAD_FILE_CONTENT__: string;
    __KICAD_FILE_NAME__: string;
    __KICAD_FILE_TYPE__: "pcb" | "schematic";
    __KICAD_PROJECT_FILES__: Record<string, string>;
  }
  function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

const vscode = acquireVsCodeApi();
const canvasContainer = document.getElementById("canvas-container")!;
const loadingOverlay = document.getElementById("loading-overlay")!;
const loadingText = document.getElementById("loading-text")!;
const mousePosEl = document.getElementById("mouse-pos")!;
const tabBar = document.getElementById("tab-bar")!;
const sidebarContent = document.getElementById("sidebar-content")!;
const pageSelector = document.getElementById("page-selector") as HTMLSelectElement;
const fileType = window.__KICAD_FILE_TYPE__;

let currentViewer: BoardViewer | SchematicViewer | null = null;
let currentProject: Project | null = null;
let currentSch: KicadSch | null = null;
let editorOverlay: EditorOverlay | null = null;
let editModeActive = false;

function unescapeHtml(text: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = text;
  return ta.value;
}

// ==================== Sidebar Tab System ====================

let activeTab = "";
const panels = new Map<string, HTMLDivElement>();

function setupTabs(tabDefs: { id: string; label: string }[]) {
  tabBar.innerHTML = "";
  sidebarContent.innerHTML = "";
  panels.clear();

  tabDefs.forEach((def, i) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (i === 0 ? " active" : "");
    tab.textContent = def.label;
    tab.dataset.panel = def.id;
    tab.addEventListener("click", () => switchTab(def.id));
    tabBar.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "panel" + (i === 0 ? " active" : "");
    panel.id = `panel-${def.id}`;
    sidebarContent.appendChild(panel);
    panels.set(def.id, panel);
  });

  activeTab = tabDefs[0]?.id ?? "";
}

function switchTab(id: string) {
  activeTab = id;
  tabBar.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", (t as HTMLElement).dataset.panel === id);
  });
  panels.forEach((p, key) => p.classList.toggle("active", key === id));
}

// ==================== Sidebar Toggle + Resizer ====================

const sidebar = document.getElementById("sidebar")!;
const resizer = document.getElementById("resizer")!;

document.getElementById("btn-sidebar-toggle")?.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

let isResizing = false;
resizer.addEventListener("mousedown", (e) => { isResizing = true; e.preventDefault(); });
document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;
  const w = document.body.clientWidth - e.clientX;
  if (w > 120 && w < 500) sidebar.style.width = w + "px";
});
document.addEventListener("mouseup", () => { isResizing = false; });

// ==================== Toolbar ====================

document.getElementById("btn-flip")?.addEventListener("click", () => {
  currentViewer?.flip_view();
});
document.getElementById("btn-zoom-fit")?.addEventListener("click", () => {
  currentViewer?.zoom_to_page();
});
document.getElementById("btn-zoom-sel")?.addEventListener("click", () => {
  currentViewer?.zoom_to_selection();
});

// ==================== Layer Colors ====================

const LAYER_COLORS: Record<string, string> = {
  "F.Cu": "#f00000", "B.Cu": "#0000f0",
  "F.SilkS": "#f0f000", "B.SilkS": "#f000f0",
  "F.Mask": "#f050a0", "B.Mask": "#50a0f0",
  "F.Paste": "#a0a050", "B.Paste": "#50a0a0",
  "F.CrtYd": "#c0c0c0", "B.CrtYd": "#c0c0c0",
  "F.Fab": "#a0a000", "B.Fab": "#00a0a0",
  "F.Adhes": "#a050a0", "B.Adhes": "#50a0f0",
  "Edge.Cuts": "#e0e000", "Dwgs.User": "#808080",
  "Cmts.User": "#606060", "Margin": "#a0a0ff",
  "In1.Cu": "#808000", "In2.Cu": "#008080",
};

// ==================== Panel Builders ====================

function buildLayerPanel(viewer: BoardViewer, board: KicadPCB) {
  const panel = panels.get("layers");
  if (!panel) return;

  const mainLayers = [
    "F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "F.Mask", "B.Mask",
    "F.CrtYd", "B.CrtYd", "F.Fab", "B.Fab", "Edge.Cuts", "Dwgs.User",
  ];
  const innerLayers = board.layers
    .map((l: any) => l.name)
    .filter((n: string) => n.startsWith("In") && n.endsWith(".Cu"));
  const allLayers = [...mainLayers, ...innerLayers];

  let html = '<div class="panel-section"><div class="panel-section-title">Board Layers</div>';
  for (const name of allLayers) {
    const color = LAYER_COLORS[name] || "#808080";
    const viewLayer = viewer.layers.by_name(name);
    const visible = viewLayer ? viewLayer.visible : false;
    html += `<div class="layer-item" data-layer="${name}">
      <div class="layer-color" style="background:${color}"></div>
      <span class="layer-name">${name}</span>
      <span class="layer-vis ${visible ? "" : "hidden"}" data-layer-vis="${name}">${visible ? "●" : "○"}</span>
    </div>`;
  }
  html += "</div>";
  panel.innerHTML = html;

  panel.querySelectorAll(".layer-item").forEach((el) => {
    el.addEventListener("click", () => {
      const layerName = (el as HTMLElement).dataset.layer!;
      const vl = viewer.layers.by_name(layerName);
      if (!vl) return;
      vl.visible = !vl.visible;
      viewer.draw();
      const vis = el.querySelector(".layer-vis")!;
      vis.textContent = vl.visible ? "●" : "○";
      vis.classList.toggle("hidden", !vl.visible);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const layerName = (el as HTMLElement).dataset.layer!;
      const vl = viewer.layers.by_name(layerName);
      if (!vl) return;
      viewer.layers.highlight(vl.highlighted ? null : layerName);
      viewer.draw();
      panel.querySelectorAll(".layer-item").forEach((item) => {
        const n = (item as HTMLElement).dataset.layer!;
        item.classList.toggle("highlighted", viewer.layers.by_name(n)?.highlighted ?? false);
      });
    });
  });
}

function buildFootprintPanel(viewer: BoardViewer, board: KicadPCB) {
  const panel = panels.get("footprints");
  if (!panel) return;

  let html = '<div class="panel-section"><div class="panel-section-title">Footprints (' + board.footprints.length + ')</div>';
  for (const fp of board.footprints) {
    const ref = fp.reference ?? fp.uuid;
    const val = fp.value ?? "";
    html += `<div class="list-item" data-fp-uuid="${fp.uuid}" title="${esc(val)}">${esc(ref)}${val ? " — " + esc(val) : ""}</div>`;
  }
  html += "</div>";
  panel.innerHTML = html;

  panel.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      viewer.select((el as HTMLElement).dataset.fpUuid!);
      viewer.zoom_to_selection();
      panel.querySelectorAll(".list-item").forEach((i) => i.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
}

function buildNetPanel(viewer: BoardViewer, board: KicadPCB) {
  const panel = panels.get("nets");
  if (!panel) return;

  const namedNets = board.nets.filter((n: any) => n.name && n.name !== "");
  let html = '<div class="panel-section"><div class="panel-section-title">Nets (' + namedNets.length + ')</div>';
  for (const net of namedNets) {
    html += `<div class="list-item" data-net="${net.number}">${esc(net.name)}</div>`;
  }
  html += "</div>";
  panel.innerHTML = html;

  panel.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      viewer.highlight_net(parseInt((el as HTMLElement).dataset.net!, 10));
      panel.querySelectorAll(".list-item").forEach((i) => i.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
}

function buildSymbolsPanel(viewer: SchematicViewer, sch: KicadSch) {
  const panel = panels.get("symbols");
  if (!panel) return;

  const symbols = sch.symbols ?? [];
  let html = '<div class="panel-section"><div class="panel-section-title">Symbols (' + symbols.length + ')</div>';
  for (const sym of symbols) {
    const ref = sym.reference ?? "?";
    const val = sym.value ?? "";
    html += `<div class="list-item" data-sym-uuid="${sym.uuid}" title="${esc(val)}">${esc(ref)}${val ? " — " + esc(val) : ""}</div>`;
  }
  html += "</div>";
  panel.innerHTML = html;

  panel.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      const uuid = (el as HTMLElement).dataset.symUuid!;
      const sym = symbols.find((s: any) => s.uuid === uuid);
      if (sym) {
        viewer.select(sym.bbox);
        viewer.zoom_to_selection();
      }
      panel.querySelectorAll(".list-item").forEach((i) => i.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
}

function buildPropertiesPanel(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<div class="panel-section">
    <div class="panel-section-title">Selection</div>
    <div id="props-content"><span style="color:var(--fg-dim)">Click an item to see its properties</span></div>
  </div>`;
  return panel;
}

function updateProperties(item: any) {
  const el = document.getElementById("props-content");
  if (!el) return;

  if (!item) {
    el.innerHTML = '<span style="color:var(--fg-dim)">Click an item to see its properties</span>';
    return;
  }

  const ctx = item.context ?? item;
  let html = "";

  if (ctx instanceof Footprint) {
    html += prop("Reference", ctx.reference);
    html += prop("Value", ctx.value);
    html += prop("Layer", ctx.layer);
    if (ctx.at) {
      html += prop("Position", `${ctx.at.position.x.toFixed(2)}, ${ctx.at.position.y.toFixed(2)} mm`);
      if (ctx.at.rotation) html += prop("Rotation", ctx.at.rotation + "°");
    }
    html += prop("Library", ctx.library_link);
    html += prop("Pads", String(ctx.pads?.length ?? 0));
    html += prop("UUID", ctx.uuid ?? "-");
  } else if (ctx instanceof SchematicSymbol) {
    html += prop("Reference", ctx.reference);
    html += prop("Value", ctx.value);
    html += prop("Footprint", ctx.footprint);
    html += prop("Library", ctx.lib_id);
    if (ctx.at) html += prop("Position", `${ctx.at.position.x.toFixed(2)}, ${ctx.at.position.y.toFixed(2)} mm`);
    html += prop("UUID", ctx.uuid ?? "-");
  } else {
    html += prop("Type", ctx.constructor?.name ?? "Unknown");
    if (ctx.uuid) html += prop("UUID", ctx.uuid);
  }

  el.innerHTML = html;
}

function buildInfoPanel(doc: KicadPCB | KicadSch, project: Project | null) {
  const panel = panels.get("info");
  if (!panel) return;

  let html = '<div class="panel-section"><div class="panel-section-title">Document Info</div><dl class="info-grid">';
  html += info("File", doc.filename);
  html += info("Version", String(doc.version));

  if (doc instanceof KicadPCB) {
    html += info("Footprints", String(doc.footprints.length));
    html += info("Nets", String(doc.nets.length));
    html += info("Traces", String(doc.segments.length));
    html += info("Vias", String(doc.vias.length));
    html += info("Zones", String(doc.zones.length));
    html += info("Layers", String(doc.layers.length));
    if (doc.general) html += info("Thickness", doc.general.thickness + "mm");
  } else {
    html += info("Symbols", String(doc.symbols?.length ?? 0));
    html += info("Sheets", String(doc.sheets?.length ?? 0));
  }

  if (doc.title_block) {
    const tb = doc.title_block;
    if (tb.title) html += info("Title", tb.title);
    if (tb.date) html += info("Date", tb.date);
    if (tb.rev) html += info("Revision", tb.rev);
    if (tb.company) html += info("Company", tb.company);
  }

  if (project) {
    let fileCount = 0;
    for (const _ of project.files()) fileCount++;
    html += info("Project Files", String(fileCount));
    let pageCount = 0;
    for (const _ of project.pages()) pageCount++;
    html += info("Pages", String(pageCount));
  }

  html += "</dl></div>";
  panel.innerHTML = html;
}

// ==================== Page Navigation ====================

function setupPageSelector(project: Project, activePage: ProjectPage) {
  const pages: ProjectPage[] = [];
  for (const p of project.pages()) pages.push(p);

  if (pages.length <= 1) {
    pageSelector.style.display = "none";
    return;
  }

  pageSelector.style.display = "block";
  pageSelector.innerHTML = "";

  for (const page of pages) {
    const opt = document.createElement("option");
    opt.value = page.project_path;
    const label = page.name || page.filename;
    const pageNum = page.page ? ` (p${page.page})` : "";
    const typeLabel = page.type === "pcb" ? " [PCB]" : "";
    opt.textContent = label + pageNum + typeLabel;
    if (page === activePage) opt.selected = true;
    pageSelector.appendChild(opt);
  }

  pageSelector.onchange = () => {
    project.set_active_page(pageSelector.value);
  };
}

// ==================== Viewer Lifecycle ====================

function wireViewerEvents(viewer: BoardViewer | SchematicViewer) {
  viewer.addEventListener("kicanvas:mousemove", () => {
    const pos = viewer.mouse_position;
    mousePosEl.textContent = `X: ${pos.x.toFixed(2)}  Y: ${pos.y.toFixed(2)} mm`;
  });

  viewer.addEventListener("kicanvas:select", () => {
    const btnZoomSel = document.getElementById("btn-zoom-sel") as HTMLButtonElement;
    btnZoomSel.disabled = !viewer.selected;
    updateProperties(viewer.selected);
  });
}

async function showPage(page: ProjectPage) {
  try {
    loadingOverlay.classList.remove("hidden");
    loadingText.textContent = `Loading ${page.name || page.filename}...`;

    if (currentViewer) {
      currentViewer.dispose();
      currentViewer = null;
    }

    const oldCanvas = canvasContainer.querySelector("canvas");
    if (oldCanvas) oldCanvas.remove();

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvasContainer.appendChild(canvas);

    const theme = themes.default;
    const doc = page.document;

    if (doc instanceof KicadPCB) {
      setupTabs([
        { id: "layers", label: "Layers" },
        { id: "footprints", label: "Footprints" },
        { id: "nets", label: "Nets" },
        { id: "properties", label: "Properties" },
        { id: "info", label: "Info" },
      ]);

      // Insert properties panel content
      const propsPanel = panels.get("properties")!;
      propsPanel.innerHTML = `<div class="panel-section"><div class="panel-section-title">Selection</div><div id="props-content"><span style="color:var(--fg-dim)">Click an item to see its properties</span></div></div>`;

      const viewer = new BoardViewer(canvas, true, theme.board);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(doc);

      wireViewerEvents(viewer);
      buildLayerPanel(viewer, doc);
      buildFootprintPanel(viewer, doc);
      buildNetPanel(viewer, doc);
      buildInfoPanel(doc, currentProject);

      document.getElementById("btn-flip")?.style.setProperty("display", "");
    } else if (doc instanceof KicadSch) {
      currentSch = doc;

      setupTabs([
        { id: "symbols", label: "Symbols" },
        { id: "properties", label: "Properties" },
        { id: "info", label: "Info" },
      ]);

      const propsPanel = panels.get("properties")!;
      propsPanel.innerHTML = `<div class="panel-section"><div class="panel-section-title">Selection</div><div id="props-content"><span style="color:var(--fg-dim)">Click an item to see its properties</span></div></div>`;

      const viewer = new SchematicViewer(canvas, true, theme.schematic);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(doc);

      wireViewerEvents(viewer);
      buildSymbolsPanel(viewer, doc);
      buildInfoPanel(doc, currentProject);

      // Reset editor overlay when schematic changes
      if (editorOverlay) {
        editorOverlay.dispose();
        editorOverlay = null;
      }
      if (editModeActive) {
        editModeActive = false;
        editorToolbar.style.display = "none";
        editModeBtn?.classList.remove("active");
      }

      document.getElementById("btn-flip")?.style.setProperty("display", "none");
    }

    loadingOverlay.classList.add("hidden");
  } catch (err: any) {
    console.error("KiCad viewer error:", err);
    loadingText.textContent = `Error: ${err.message || err}`;
    loadingText.style.color = "#f44";
  }
}

// ==================== Initial Load ====================

async function loadProject(projectFiles: Record<string, string>, primaryFileName: string) {
  loadingText.textContent = "Loading project...";
  loadingOverlay.classList.remove("hidden");

  // Create File objects for the VFS
  const files: File[] = [];
  for (const [name, content] of Object.entries(projectFiles)) {
    files.push(new File([content], name, { type: "text/plain" }));
  }

  // If project has multiple files, use the Project class
  const hasMultipleFiles = files.length > 1;

  if (hasMultipleFiles) {
    const project = new Project();
    currentProject = project;

    const vfs = new LocalFileSystem(files);
    await project.load(vfs);

    // Find the page that matches the opened file
    let targetPage: ProjectPage | undefined;
    for (const page of project.pages()) {
      if (page.filename === primaryFileName) {
        targetPage = page;
        break;
      }
    }

    if (!targetPage) {
      targetPage = project.first_page ?? undefined;
    }

    if (targetPage) {
      setupPageSelector(project, targetPage);
      project.set_active_page(targetPage);

      // Listen for page changes
      project.addEventListener("change", () => {
        const page = project.active_page;
        if (page) {
          showPage(page);
          // Update selector
          pageSelector.value = page.project_path;
        }
      });

      await showPage(targetPage);
    }
  } else {
    // Single file mode - no project
    currentProject = null;
    const content = projectFiles[primaryFileName] ?? Object.values(projectFiles)[0]!;
    const name = primaryFileName || Object.keys(projectFiles)[0]!;

    const theme = themes.default;

    const oldCanvas = canvasContainer.querySelector("canvas");
    if (oldCanvas) oldCanvas.remove();
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvasContainer.appendChild(canvas);

    if (fileType === "pcb") {
      setupTabs([
        { id: "layers", label: "Layers" },
        { id: "footprints", label: "Footprints" },
        { id: "nets", label: "Nets" },
        { id: "properties", label: "Properties" },
        { id: "info", label: "Info" },
      ]);
      const propsPanel = panels.get("properties")!;
      propsPanel.innerHTML = `<div class="panel-section"><div class="panel-section-title">Selection</div><div id="props-content"><span style="color:var(--fg-dim)">Click an item</span></div></div>`;

      const board = new KicadPCB(name, content);
      const viewer = new BoardViewer(canvas, true, theme.board);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(board);
      wireViewerEvents(viewer);
      buildLayerPanel(viewer, board);
      buildFootprintPanel(viewer, board);
      buildNetPanel(viewer, board);
      buildInfoPanel(board, null);
    } else {
      setupTabs([
        { id: "symbols", label: "Symbols" },
        { id: "properties", label: "Properties" },
        { id: "info", label: "Info" },
      ]);
      const propsPanel = panels.get("properties")!;
      propsPanel.innerHTML = `<div class="panel-section"><div class="panel-section-title">Selection</div><div id="props-content"><span style="color:var(--fg-dim)">Click an item</span></div></div>`;

      const sch = new KicadSch(name, content);
      currentSch = sch;
      const viewer = new SchematicViewer(canvas, true, theme.schematic);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(sch);
      wireViewerEvents(viewer);
      buildSymbolsPanel(viewer, sch);
      buildInfoPanel(sch, null);
    }

    loadingOverlay.classList.add("hidden");
  }
}

// Helpers
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function prop(label: string, value: string): string {
  return `<div class="prop-row"><span class="prop-label">${esc(label)}</span><span class="prop-value">${esc(value || "-")}</span></div>`;
}
function info(label: string, value: string): string {
  return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
}

// ==================== Editor Mode ====================

const editorToolbar = document.getElementById("editor-toolbar")!;
const editorStatusEl = document.getElementById("editor-status")!;
const editModeBtn = document.getElementById("btn-edit-mode");

function toggleEditMode() {
  editModeActive = !editModeActive;

  // Find the kicanvas viewer canvas
  const viewerCanvas = canvasContainer.querySelector("canvas:not([data-editor])") as HTMLCanvasElement | null;

  if (editModeActive) {
    editorToolbar.style.display = "flex";
    editModeBtn?.classList.add("active");

    // Hide kicanvas viewer canvas
    if (viewerCanvas) viewerCanvas.style.display = "none";

    // Create overlay if needed, importing current schematic data
    if (!editorOverlay) {
      editorOverlay = new EditorOverlay(canvasContainer, editorStatusEl, currentSch ?? undefined);
      editorOverlay.canvas.dataset.editor = "true";
    }
    editorOverlay.canvas.style.display = "block";
  } else {
    editorToolbar.style.display = "none";
    editModeBtn?.classList.remove("active");

    // Show kicanvas viewer canvas, hide editor overlay
    if (viewerCanvas) viewerCanvas.style.display = "block";
    if (editorOverlay) {
      editorOverlay.canvas.style.display = "none";
    }
  }
}

editModeBtn?.addEventListener("click", toggleEditMode);

// Editor tool buttons
editorToolbar.querySelectorAll(".etool").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!editorOverlay) return;
    const tool = (btn as HTMLElement).dataset.tool as ToolType;
    editorOverlay.setTool(tool);

    // Update active state on buttons
    editorToolbar.querySelectorAll(".etool").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Undo/Redo buttons
document.getElementById("btn-undo")?.addEventListener("click", () => {
  if (!editorOverlay) return;
  const desc = editorOverlay.doc.performUndo();
  if (desc) editorStatusEl.textContent = `Undo: ${desc}`;
});
document.getElementById("btn-redo")?.addEventListener("click", () => {
  if (!editorOverlay) return;
  const desc = editorOverlay.doc.performRedo();
  if (desc) editorStatusEl.textContent = `Redo: ${desc}`;
});

// Poll tool state to sync button highlights with keyboard shortcuts
setInterval(() => {
  if (!editorOverlay || !editModeActive) return;
  const currentTool = editorOverlay.tools.activeTool;
  editorToolbar.querySelectorAll(".etool").forEach((btn) => {
    const tool = (btn as HTMLElement).dataset.tool;
    btn.classList.toggle("active", tool === currentTool);
  });
}, 100);

// Keyboard shortcut to toggle edit mode
document.addEventListener("keydown", (e) => {
  if (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey && fileType === "schematic") {
    // Only toggle if we're not in an input or the editor canvas
    if (document.activeElement === document.body || document.activeElement === canvasContainer) {
      toggleEditMode();
      e.preventDefault();
    }
  }
});

// Boot
const primaryContent = unescapeHtml(window.__KICAD_FILE_CONTENT__);
const primaryFileName = window.__KICAD_FILE_NAME__;
const projectFiles = window.__KICAD_PROJECT_FILES__;

// Ensure the primary file is in the project files map (in case it wasn't gathered)
if (!projectFiles[primaryFileName]) {
  projectFiles[primaryFileName] = primaryContent;
}

loadProject(projectFiles, primaryFileName).catch((err) => {
  console.error("Failed to load project:", err);
  loadingText.textContent = `Error: ${err.message || err}`;
  loadingText.style.color = "#f44";
});

// Handle file updates from the extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "update") {
    const updatedFiles = msg.projectFiles ?? { [msg.fileName]: msg.content };
    loadProject(updatedFiles, msg.fileName).catch(console.error);
  }
});

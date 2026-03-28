import { KicadPCB, KicadSch } from "../kicanvas/kicad";
import { Footprint } from "../kicanvas/kicad/board";
import { SchematicSymbol } from "../kicanvas/kicad/schematic";
import { BoardViewer } from "../kicanvas/viewers/board/viewer";
import { EditableSchematicViewer } from "../kicanvas/viewers/schematic/editable-viewer";
import type { EditEvent } from "../kicanvas/viewers/schematic/editable-viewer";
import { Project, ProjectPage } from "../kicanvas/kicanvas/project";
import { LocalFileSystem } from "../kicanvas/kicanvas/services/vfs";
import themes from "../kicanvas/kicanvas/themes/index";
import { ToolType, ToolManager } from "../editor/tools";
import { KicadSchDoc } from "../editor/kicad-sch-doc";
import { SymbolLibrary } from "./symbol-library";
import { isEditable, type EditableItem } from "../kicanvas/kicad/schematic-edit";
import { Vec2 } from "../kicanvas/base/math";

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

let currentViewer: BoardViewer | EditableSchematicViewer | null = null;
let currentProject: Project | null = null;
let currentSch: KicadSch | null = null;
let currentDoc: KicadSchDoc | null = null;
let currentToolManager: ToolManager | null = null;
let symLibrary: SymbolLibrary | null = null;

function showLoadError(err: unknown) {
  console.error("Failed to load KiCad document:", err);
  const message = err instanceof Error ? err.message : String(err);
  loadingOverlay.classList.remove("hidden");
  loadingText.textContent = `Error: ${message}`;
  loadingText.style.color = "#f44";
}

function shouldLoadAsProject(projectFiles: Record<string, string>, primaryFileName: string): boolean {
  if (fileType === "project") {
    return true;
  }
  return Object.keys(projectFiles).length > 1;
}

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
    .map((l: any) => l.canonical_name || l.name)
    .filter((n: string) => n && n.startsWith("In") && n.endsWith(".Cu"));
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

function buildSymbolsPanel(viewer: EditableSchematicViewer, sch: KicadSch) {
  const panel = panels.get("symbols");
  if (!panel) return;

  const symbols = [...(sch.symbols?.values() ?? [])];
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
      viewer.select(uuid);
      viewer.zoom_to_selection();
      panel.querySelectorAll(".list-item").forEach((i) => i.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
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
    html += info("Symbols", String(doc.symbols?.size ?? 0));
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

// ==================== Unified Editing ====================

const editorToolbar = document.getElementById("editor-toolbar")!;
const editorStatusEl = document.getElementById("editor-status")!;

function setupUnifiedEditing(viewer: EditableSchematicViewer, sch: KicadSch) {
  const doc = new KicadSchDoc(sch);
  currentDoc = doc;

  // Build symbol library
  symLibrary = SymbolLibrary.build(sch, projectFiles);
  if (globalLibraryIndex) {
    symLibrary.addGlobalIndex(globalLibraryIndex);
  }

  const toolManager = new ToolManager(doc, {
    requestRedraw: () => viewer.requestOverlayRepaint(),
    requestRepaint: () => viewer.repaintAll(),
    requestSymbolChooser: () => promptSymbol(),
    requestLabelText: (current) => promptLabel(current),
    showStatus: (msg) => { editorStatusEl.textContent = msg; },
    setCursor: (cursor) => { viewer.canvas.style.cursor = cursor; },
    editProperties: (item) => editProperties(item, doc, viewer),
  });
  toolManager.symLibrary = symLibrary;
  currentToolManager = toolManager;

  // Wire viewer edit events to tool manager
  viewer.onEditEvent = (evt: EditEvent) => {
    const pos = evt.worldPos;
    const snapped = toolManager.grid.snapToGrid(pos);
    const snappedVec = new Vec2(snapped.x, snapped.y);

    // Map EditEvent to ToolEvent
    const toolEvt = {
      type: evt.type as any,
      pos: snappedVec,
      rawPos: pos,
      key: evt.key,
      shift: evt.shift,
      ctrl: evt.ctrl,
      button: evt.button,
      hits: evt.hits,
    };

    toolManager.handleEvent(toolEvt);

    // Sync selection between viewer and tool manager
    if (evt.type === "click" || evt.type === "mousedown") {
      syncSelectionToViewer(viewer, toolManager);
    }

    if (evt.type === "motion") {
      const topHit = evt.hits[0];
      viewer.setHovered(topHit?.item ?? null);
    }
  };

  // Show toolbar
  editorToolbar.style.display = "flex";
}

function syncSelectionToViewer(viewer: EditableSchematicViewer, toolManager: ToolManager) {
  viewer.clearSelection();
  for (const item of toolManager.selection) {
    viewer.selectItem(item, true);
  }
}

// ==================== Viewer Lifecycle ====================

function wireViewerEvents(viewer: BoardViewer | EditableSchematicViewer) {
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
    currentDoc = null;
    currentToolManager = null;

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

      const propsPanel = panels.get("properties")!;
      propsPanel.innerHTML = `<div class="panel-section"><div class="panel-section-title">Selection</div><div id="props-content"><span style="color:var(--fg-dim)">Click an item to see its properties</span></div></div>`;

      const viewer = new BoardViewer(canvas, true, theme.board);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(doc);

      wireViewerEvents(viewer);
      try {
        buildLayerPanel(viewer, doc);
        buildFootprintPanel(viewer, doc);
        buildNetPanel(viewer, doc);
        buildInfoPanel(doc, currentProject);
      } catch (panelErr) {
        console.warn("Panel build error (non-fatal):", panelErr);
      }

      editorToolbar.style.display = "none";
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

      const viewer = new EditableSchematicViewer(canvas, true, theme.schematic);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(doc);

      wireViewerEvents(viewer);
      buildSymbolsPanel(viewer, doc);
      buildInfoPanel(doc, currentProject);

      // Always-on editing for schematics
      setupUnifiedEditing(viewer, doc);

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
  loadingText.style.color = "";
  loadingOverlay.classList.remove("hidden");

  const files: File[] = [];
  for (const [name, content] of Object.entries(projectFiles)) {
    files.push(new File([content], name, { type: "text/plain" }));
  }

  const loadAsProject = shouldLoadAsProject(projectFiles, primaryFileName);

  if (loadAsProject) {
    const project = new Project();
    currentProject = project;

    const vfs = new LocalFileSystem(files);
    await project.load(vfs);

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

    if (!targetPage) {
      throw new Error(`Unable to find a loadable project page for ${primaryFileName}`);
    }

    setupPageSelector(project, targetPage);
    project.set_active_page(targetPage);

    project.addEventListener("change", () => {
      const page = project.active_page;
      if (page) {
        showPage(page).catch(showLoadError);
        pageSelector.value = page.project_path;
      }
    });

    await showPage(targetPage);
  } else {
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
      editorToolbar.style.display = "none";
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
      const viewer = new EditableSchematicViewer(canvas, true, theme.schematic);
      currentViewer = viewer;
      await viewer.setup();
      await viewer.load(sch);
      wireViewerEvents(viewer);
      buildSymbolsPanel(viewer, sch);
      buildInfoPanel(sch, null);

      // Always-on editing
      setupUnifiedEditing(viewer, sch);
    }

    loadingOverlay.classList.add("hidden");
  }
}

// ==================== Dialogs ====================

function promptSymbol(): Promise<string | null> {
  return new Promise((resolve) => {
    const lib = symLibrary;
    if (!lib) { resolve(null); return; }

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#252526;border:1px solid #3c3c3c;border-radius:6px;width:420px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);";

    const header = document.createElement("div");
    header.style.cssText = "padding:12px 16px;border-bottom:1px solid #3c3c3c;font-size:13px;color:#e0e0e0;font-weight:600;";
    header.textContent = `Choose Symbol (${lib.size} available)`;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search symbols...";
    input.style.cssText = "margin:8px 12px;padding:6px 10px;background:#1e1e1e;border:1px solid #3c3c3c;border-radius:4px;color:#ccc;font-size:12px;outline:none;";

    const list = document.createElement("div");
    list.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;min-height:100px;max-height:50vh;";

    modal.appendChild(header);
    modal.appendChild(input);
    modal.appendChild(list);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let debounceTimer: number;

    const renderList = (query: string) => {
      const results = lib.search(query);
      const grouped = new Map<string, typeof results>();
      for (const r of results) {
        const g = grouped.get(r.libraryName) ?? [];
        g.push(r);
        grouped.set(r.libraryName, g);
      }

      let html = "";
      for (const [libName, entries] of grouped) {
        html += `<div style="padding:4px 12px;font-size:10px;color:#858585;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">${esc(libName)}</div>`;
        for (const e of entries) {
          html += `<div class="sym-item" data-id="${esc(e.fullId)}" style="padding:4px 16px;font-size:12px;color:#ccc;cursor:pointer;border-radius:3px;margin:0 4px;">${esc(e.symbolName)}</div>`;
        }
      }
      if (results.length === 0) {
        html = `<div style="padding:16px;color:#858585;text-align:center;">No symbols found</div>`;
      }
      list.innerHTML = html;

      list.querySelectorAll(".sym-item").forEach((el) => {
        el.addEventListener("mouseenter", () => (el as HTMLElement).style.background = "#2a2d2e");
        el.addEventListener("mouseleave", () => (el as HTMLElement).style.background = "");
        el.addEventListener("click", () => {
          const fullId = (el as HTMLElement).dataset.id!;
          if (!lib.isLoaded(fullId)) {
            const libName = fullId.split(":")[0]!;
            vscode.postMessage({ type: "requestLibrary", libraryName: libName });
            (el as HTMLElement).textContent = "Loading...";
            (el as HTMLElement).style.color = "#858585";
            const checkLoaded = setInterval(() => {
              if (lib.isLoaded(fullId)) {
                clearInterval(checkLoaded);
                cleanup();
                resolve(fullId);
              }
            }, 100);
            setTimeout(() => {
              clearInterval(checkLoaded);
              if (document.body.contains(overlay)) {
                (el as HTMLElement).textContent = "Failed to load";
                (el as HTMLElement).style.color = "#f44";
              }
            }, 5000);
          } else {
            cleanup();
            resolve(fullId);
          }
        });
      });
    };

    const cleanup = () => {
      clearTimeout(debounceTimer);
      document.body.removeChild(overlay);
    };

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => renderList(input.value), 100);
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); cleanup(); resolve(null); }
      if (e.key === "Enter") {
        const first = list.querySelector(".sym-item") as HTMLElement | null;
        if (first) { cleanup(); resolve(first.dataset.id!); }
      }
    });

    renderList("");
    setTimeout(() => input.focus(), 0);
  });
}

function promptLabel(current?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#252526;border:1px solid #3c3c3c;border-radius:6px;width:320px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);";

    const label = document.createElement("div");
    label.style.cssText = "font-size:13px;color:#e0e0e0;font-weight:600;margin-bottom:8px;";
    label.textContent = "Enter label text";

    const input = document.createElement("input");
    input.type = "text";
    input.value = current ?? "";
    input.style.cssText = "width:100%;padding:6px 10px;background:#1e1e1e;border:1px solid #3c3c3c;border-radius:4px;color:#ccc;font-size:12px;outline:none;box-sizing:border-box;";

    modal.appendChild(label);
    modal.appendChild(input);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => { document.body.removeChild(overlay); };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.stopPropagation(); cleanup(); resolve(input.value.trim() || null); }
      if (e.key === "Escape") { e.stopPropagation(); cleanup(); resolve(null); }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });

    setTimeout(() => input.focus(), 0);
  });
}

function editProperties(item: any, doc: KicadSchDoc, viewer: EditableSchematicViewer) {
  // TODO: Port property editor dialog for KicadSch items
  // For now, show basic info
  console.log("Edit properties:", item);
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

// ==================== Editor Toolbar ====================

// Editor tool buttons
editorToolbar.querySelectorAll(".etool").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!currentToolManager) return;
    const tool = (btn as HTMLElement).dataset.tool as ToolType;
    currentToolManager.setTool(tool);
    editorToolbar.querySelectorAll(".etool").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Undo/Redo buttons
document.getElementById("btn-undo")?.addEventListener("click", () => {
  if (!currentDoc) return;
  const desc = currentDoc.performUndo();
  if (desc) editorStatusEl.textContent = `Undo: ${desc}`;
  if (currentViewer instanceof EditableSchematicViewer) currentViewer.repaintAll();
});
document.getElementById("btn-redo")?.addEventListener("click", () => {
  if (!currentDoc) return;
  const desc = currentDoc.performRedo();
  if (desc) editorStatusEl.textContent = `Redo: ${desc}`;
  if (currentViewer instanceof EditableSchematicViewer) currentViewer.repaintAll();
});

// Poll tool state to sync button highlights
setInterval(() => {
  if (!currentToolManager) return;
  const currentTool = currentToolManager.activeTool;
  editorToolbar.querySelectorAll(".etool").forEach((btn) => {
    const tool = (btn as HTMLElement).dataset.tool;
    btn.classList.toggle("active", tool === currentTool);
  });
}, 100);

// Boot
const primaryContent = unescapeHtml(window.__KICAD_FILE_CONTENT__);
const primaryFileName = window.__KICAD_FILE_NAME__;
const projectFiles = window.__KICAD_PROJECT_FILES__;

if (!projectFiles[primaryFileName]) {
  projectFiles[primaryFileName] = primaryContent;
}

loadProject(projectFiles, primaryFileName).catch((err) => {
  showLoadError(err);
});

// Global library index received from extension
let globalLibraryIndex: { libraries: { name: string; symbolNames: string[] }[] } | null = null;

// Handle messages from the extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "update") {
    const updatedFiles = msg.projectFiles ?? { [msg.fileName]: msg.content };
    loadProject(updatedFiles, msg.fileName).catch(showLoadError);
  }
  if (msg.type === "requestSave") {
    // TODO: Serialize KicadSch directly when unified serialization is done
    // For now, send back original content (save not yet supported in unified mode)
    vscode.postMessage({ type: "saveContent", content: primaryContent });
  }
  if (msg.type === "globalLibraryIndex") {
    globalLibraryIndex = msg.index;
    if (symLibrary) {
      symLibrary.addGlobalIndex(msg.index);
    }
  }
  if (msg.type === "libraryContent") {
    if (symLibrary) {
      symLibrary.loadLibraryContent(msg.libraryName, msg.content);
    }
  }
  if (msg.type === "setTool") {
    if (currentToolManager) currentToolManager.setTool(msg.tool);
  }
  if (msg.type === "toggleEditMode") {
    // No-op: editing is always on
  }
});

// Notify extension when editor state becomes dirty
setInterval(() => {
  if (currentDoc?.dirty) {
    vscode.postMessage({ type: "dirty" });
  }
}, 500);

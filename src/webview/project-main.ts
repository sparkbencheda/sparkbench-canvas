// Project dashboard for .kicad_pro files

declare global {
  interface Window {
    __KICAD_FILE_CONTENT__: string;
    __KICAD_FILE_NAME__: string;
    __KICAD_PROJECT_FILES__: Record<string, string>;
  }
  function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

const vscode = acquireVsCodeApi();
const dashboard = document.getElementById("dashboard")!;
const projectFiles = window.__KICAD_PROJECT_FILES__;
const fileName = window.__KICAD_FILE_NAME__;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseSymLibTable(content: string): { name: string; uri: string }[] {
  const results: { name: string; uri: string }[] = [];
  const re = /\(lib\s+\(name\s+"([^"]+)"\).*?\(uri\s+"([^"]+)"\)/g;
  let m;
  while ((m = re.exec(content)) !== null) results.push({ name: m[1]!, uri: m[2]! });
  return results;
}

function parseFpLibTable(content: string): { name: string; uri: string }[] {
  const results: { name: string; uri: string }[] = [];
  const re = /\(lib\s+\(name\s+"([^"]+)"\).*?\(uri\s+"([^"]+)"\)/g;
  let m;
  while ((m = re.exec(content)) !== null) results.push({ name: m[1]!, uri: m[2]! });
  return results;
}

function openFile(name: string) {
  vscode.postMessage({ type: "openFile", fileName: name });
}

function render() {
  let pro: any = {};
  try {
    pro = JSON.parse(window.__KICAD_FILE_CONTENT__);
  } catch {
    dashboard.innerHTML = `<h1>Error</h1><p>Could not parse ${esc(fileName)}</p>`;
    return;
  }

  const projectName = fileName.replace(".kicad_pro", "");
  let html = `<h1>${esc(projectName)}</h1>`;
  html += `<div class="subtitle">${esc(fileName)}</div>`;
  html += `<div class="card-grid">`;

  // Project Info card
  html += `<div class="card"><div class="card-title">Project Info</div>`;
  html += kv("Name", projectName);
  if (pro.meta?.version) html += kv("Version", String(pro.meta.version));
  if (pro.meta?.filename) html += kv("File", pro.meta.filename);
  html += `</div>`;

  // Sheets card - find .kicad_sch files in projectFiles
  const schFiles = Object.keys(projectFiles).filter((f) => f.endsWith(".kicad_sch"));
  if (schFiles.length > 0) {
    html += `<div class="card"><div class="card-title">Schematic Sheets (${schFiles.length})</div>`;
    for (const f of schFiles) {
      html += `<div class="file-link" data-open="${esc(f)}">${esc(f)}</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`; // close card-grid top row

  html += `<div class="card-grid">`;

  // Symbol Libraries card
  const symTable = projectFiles["sym-lib-table"];
  if (symTable) {
    const libs = parseSymLibTable(symTable);
    html += `<div class="card"><div class="card-title">Symbol Libraries (${libs.length})</div>`;
    for (const lib of libs) {
      const resolvedUri = lib.uri.replace(/\$\{KIPRJMOD\}\//, "");
      const fileExists = resolvedUri in projectFiles;
      html += `<div class="lib-item"><span class="lib-name">${esc(lib.name)}</span>`;
      html += `<span class="lib-detail">${fileExists ? "loaded" : esc(resolvedUri)}</span></div>`;
    }
    html += `</div>`;
  }

  // Footprint Libraries card
  const fpTable = projectFiles["fp-lib-table"];
  if (fpTable) {
    const libs = parseFpLibTable(fpTable);
    html += `<div class="card"><div class="card-title">Footprint Libraries (${libs.length})</div>`;
    for (const lib of libs) {
      html += `<div class="lib-item"><span class="lib-name">${esc(lib.name)}</span>`;
      html += `<span class="lib-detail">${esc(lib.uri.replace(/\$\{KIPRJMOD\}\//, ""))}</span></div>`;
    }
    html += `</div>`;
  }

  html += `</div>`; // close card-grid

  // Design Rules card
  const ds = pro.board?.design_settings;
  if (ds) {
    html += `<div class="card"><div class="card-title">Design Rules</div>`;
    html += `<table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>`;

    const rules = ds.rules;
    if (rules) {
      if (rules.min_clearance != null) html += row("Min Clearance", rules.min_clearance + " mm");
      if (rules.min_track_width != null) html += row("Min Track Width", rules.min_track_width + " mm");
      if (rules.min_via_diameter != null) html += row("Min Via Diameter", rules.min_via_diameter + " mm");
      if (rules.min_via_annular_width != null) html += row("Min Via Annular Width", rules.min_via_annular_width + " mm");
      if (rules.min_microvia_diameter != null) html += row("Min uVia Diameter", rules.min_microvia_diameter + " mm");
      if (rules.min_hole_clearance != null) html += row("Min Hole Clearance", rules.min_hole_clearance + " mm");
      if (rules.min_silk_clearance != null) html += row("Min Silk Clearance", rules.min_silk_clearance + " mm");
    }

    // Track widths
    const tw = ds.track_widths;
    if (tw && tw.length > 0) {
      html += row("Track Widths", tw.map((w: number) => w + " mm").join(", "));
    }

    // Via sizes
    const vs = ds.via_dimensions;
    if (vs && vs.length > 0) {
      const viaSizes = vs
        .filter((v: any) => v.diameter > 0)
        .map((v: any) => `${v.diameter}/${v.drill} mm`);
      if (viaSizes.length > 0) html += row("Via Sizes", viaSizes.join(", "));
    }

    html += `</tbody></table></div>`;
  }

  // Net Classes card
  const netSettings = pro.net_settings;
  if (netSettings?.classes) {
    const classes = Object.entries(netSettings.classes) as [string, any][];
    html += `<div class="card"><div class="card-title">Net Classes (${classes.length})</div>`;
    html += `<table><thead><tr><th>Name</th><th>Clearance</th><th>Track Width</th><th>Via Dia/Drill</th></tr></thead><tbody>`;
    for (const [name, nc] of classes) {
      html += `<tr><td>${esc(name)}</td><td>${nc.clearance ?? "-"} mm</td><td>${nc.track_width ?? "-"} mm</td><td>${nc.via_diameter ?? "-"}/${nc.via_drill ?? "-"} mm</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Text Variables card
  const textVars = pro.text_variables;
  if (textVars && Object.keys(textVars).length > 0) {
    html += `<div class="card"><div class="card-title">Text Variables</div>`;
    for (const [key, val] of Object.entries(textVars)) {
      html += kv(key, String(val));
    }
    html += `</div>`;
  }

  // PCB files
  const pcbFiles = Object.keys(projectFiles).filter((f) => f.endsWith(".kicad_pcb"));
  if (pcbFiles.length > 0) {
    html += `<div class="card"><div class="card-title">Board Files</div>`;
    for (const f of pcbFiles) {
      html += `<div class="file-link" data-open="${esc(f)}">${esc(f)}</div>`;
    }
    html += `</div>`;
  }

  dashboard.innerHTML = html;

  // Wire up file links
  dashboard.querySelectorAll(".file-link[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      openFile((el as HTMLElement).dataset.open!);
    });
  });
}

function kv(label: string, value: string): string {
  return `<div class="kv"><span class="kv-label">${esc(label)}</span><span class="kv-value">${esc(value)}</span></div>`;
}

function row(label: string, value: string): string {
  return `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
}

render();

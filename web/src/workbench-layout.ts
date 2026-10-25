/** Static workbench chrome and grouped settings. Dialogs for model I/O live in app-shell. */
const numberField = (
  id: string,
  label: string,
  value: string,
  step: string,
  unit = 'mm',
  max = '20',
  min = '0',
  fit = false,
) => `<div ${fit ? 'data-fit-only' : ''}>
  <label class="section-label" for="${id}">${label}</label>
  <div class="input-wrap"><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/><span>${unit}</span></div>
</div>`;

/** Render commands, editable panels, and the 3D viewport without application state. */
export function renderWorkbenchLayout(icon: (name: string) => string) {
  const command = (target: string, label: string) =>
    `<button type="button" data-command="${target}">${label}</button>`;
  return `
<header>
  <div class="brand"><div class="brand-mark">${icon('mountain')}</div><h1>Contour Workbench</h1></div>
  <nav class="command-bar" aria-label="Application commands">
    <details class="command-menu"><summary>File</summary><div class="command-popup">
      <button id="new-project">New project…</button><button id="open-project">Open project…</button>
      <button id="show-projects">Recent projects…</button><button id="save-project">Export project…</button>
    </div></details>
    <details class="command-menu"><summary>View</summary><div class="command-popup">
      ${command('fit-view', 'Fit model')}${command('top-view', 'Top view')}${command('north-up', 'North up')}
      <hr/>${command('contours', 'Contours')}${command('topo-map', 'Basemap')}${command('wireframe', 'Wireframe')}
    </div></details>
    <details class="command-menu"><summary>Model</summary><div class="command-popup">
      ${command('change-area', 'Edit area…')}${command('generate', 'Generate model')}
      <button data-panel="inspect">Inspect generated model</button>${command('download', 'Export model…')}
    </div></details>
    <details class="command-menu"><summary>Tools</summary><div class="command-popup">
      <div id="fit-calibration"><button id="download-calibration">Fit calibration…</button></div>
      <div id="color-calibration" class="hidden"><button id="download-color-calibration">Export multicolor test</button></div>
      <button data-dialog="sources-dialog">Manage data sources…</button>
    </div></details>
    <details class="command-menu"><summary>Help</summary><div class="command-popup">
      <button data-dialog="help-dialog">Navigation and terminology…</button>
      <button data-dialog="help-dialog" data-help-section="storage-help">Storage and offline use…</button>
    </div></details>
  </nav>
  <span class="saved-indicator"><span class="dot"></span><span id="save-status">Local workspace</span></span>
</header>
<div class="workspace">
  <aside id="settings-panel" aria-label="Model settings">
    <button id="mobile-close" class="mobile-only btn" aria-label="Close settings">Close settings ×</button>
    <div class="sidebar-heading"><h2>Model settings</h2></div>
    <nav class="tabs" aria-label="Workbench panels">
      <button class="tab active" data-tab="terrain">Terrain</button>
      <button class="tab" data-tab="features">Features <span id="feature-count" class="badge">—</span></button>
      <button class="tab" data-tab="annotations">Annotations</button>
      <button class="tab" data-tab="print">Print setup</button>
      <button class="tab" data-tab="inspect">Inspect</button>
    </nav>
    <div class="sidebar-body">
      <div id="tab-terrain">
        <section class="panel"><h3>Area</h3><div class="location-card">
          <strong id="location-name">Post Canyon, Oregon</strong><p id="coordinates">45.69° N · 121.64° W</p>
          <button id="change-area" class="btn">Edit area…</button></div>
          <div class="source-pill"><span id="source-name">Loading example…</span></div>
        </section>
        <section class="panel"><h3>Model dimensions</h3>
          <label class="section-label">Maximum model size <span>width × depth</span></label>
          <div class="input-row"><div class="input-wrap"><input id="bed-width" type="number" min="30" max="1000" value="248" aria-label="Maximum model width"/><span>mm</span></div><span>×</span><div class="input-wrap"><input id="bed-depth" type="number" min="30" max="1000" value="198" aria-label="Maximum model depth"/><span>mm</span></div></div>
          <p class="help">Scales the terrain to fit within these dimensions. The actual footprint is shown below the model.</p>
          <label class="section-label" for="height-factor">Vertical exaggeration <output id="height-value">1.0×</output></label>
          <input id="height-factor" type="range" min="0.25" max="3" value="1" step="0.05" list="height-ticks"/>
          <datalist id="height-ticks"><option value="1" label="1×"></option></datalist>
          <div class="section-label"><span>0.25×</span><span>1× = true scale</span><span>3×</span></div>
          ${numberField('base-height', 'Base thickness', '1', '0.1', 'mm', '30', '0.5')}
        </section>
        <section class="panel"><h3>Elevation</h3>
          <label class="section-label" for="source">Elevation source</label>
          <select id="source"><option value="auto">Automatic</option><option value="usgs_3dep_10m">USGS 3DEP · 10 m</option><option value="usgs_3dep_30m">USGS 3DEP · 30 m</option><option value="copernicus_glo30">Copernicus GLO-30 · 30 m</option><option value="copernicus_glo90">Copernicus GLO-90 · 90 m</option></select>
          <button class="btn full-width" id="load-area">Reload elevation</button><div id="tile-downloads" class="help"></div>
          <button class="small-link full-width" id="upload-dem">Import GeoTIFF…</button>
          <details class="setting-help"><summary>Source selection</summary><p class="help">Automatic selects 10, 30, or 90 m samples based on area size and region. Select a source to override.</p></details>
        </section>
        <section class="panel"><h3>Mesh detail</h3>
          <label class="section-label" for="quality">Terrain detail</label>
          <select id="quality"><option value="0">Full source resolution</option><option value="0.02">Adaptive · 0.02 mm error</option><option value="0.05">Adaptive · 0.05 mm error</option><option value="0.1">Adaptive · 0.10 mm error</option><option value="0.25">Adaptive · 0.25 mm error</option></select>
          <p class="help" id="quality-caption">Uses all source elevation samples</p>
        </section>
      </div>
      <div id="tab-features" class="hidden">
        <section class="panel feature-browser"><div class="panel-title"><h3>Features</h3><button class="btn" data-dialog="sources-dialog">Add features…</button></div>
          <div class="search">${icon('search')}<input id="feature-search" placeholder="Search features or sources" aria-label="Search features"/></div>
          <p class="help">Checkboxes include features in the generated model.</p>
          <div class="bulk-actions"><select id="feature-bulk-scope" aria-label="Bulk action scope"><option value="results">Search results</option><option value="all">All features</option></select><button class="small-link" id="all-features">Exclude all</button></div>
          <div id="feature-list"></div>
        </section>
        <section class="panel" id="feature-properties" aria-label="Selection properties"></section>
        <section class="panel"><details id="class-priority"><summary>Overlap priority</summary><p class="help">Higher classes take overlapping areas first. Within a class, inserts or color regions take precedence over grooves.</p><div id="class-priority-list"></div><button class="small-link" id="reset-class-priority">Reset priority</button></details>
          <label class="winter-toggle"><input id="winter-mode" type="checkbox"/><span><strong>Winter preset</strong><small>Excludes trails, includes ski runs and glaciers, and carves lifts. Loads ski data if missing. Turning it off restores previous feature settings.</small></span></label>
        </section>
      </div>
      <div id="tab-annotations" class="hidden"></div>
      <div id="tab-print" class="hidden">
        <section class="panel"><h3>Print method</h3><label class="section-label" for="manufacturing-mode">Assembly mode</label><select id="manufacturing-mode"><option value="separate">Separate inserts</option><option value="multicolor">Multicolor print</option></select><p class="help" id="manufacturing-guidance"></p>
          ${numberField('insert-relative-height', 'Height offset from terrain', '0.35', '0.05', 'mm', '10', '-10')}
          <p class="help">Positive: raised · Zero: flush · Negative: recessed</p>
        </section>
        <section class="panel"><h3>Materials</h3>
          <div class="input-row"><label>Terrain color<input id="terrain-color" type="color" value="#8baa73"/></label><label>Filament slot<input id="terrain-extruder" type="number" min="1" max="16" value="1"/></label></div>
          <div class="input-row"><label>Feature color<input id="feature-color" type="color" value="#f4b45e"/></label><label>Filament slot<input id="feature-extruder" type="number" min="1" max="16" value="2"/></label></div>
        </section>
        <section class="panel"><h3 id="feature-settings-title">Feature geometry</h3>
          ${numberField('nozzle-diameter', 'Nozzle diameter', '0.4', '0.05', 'mm', '1.2', '0.2')}
          ${numberField('path-width', 'Path width', '0.9', '0.05', 'mm', '20', '0.2')}
          ${numberField('carve-depth', 'V-carve / recess depth', '0.4', '0.05', 'mm', '20', '0.05')}
          <details class="setting-group"><summary>Advanced geometry</summary>
            ${numberField('clearance', 'Feature separation', '0.1', '0.05', 'mm', '20', '0.05')}
            ${numberField('edge-clearance', 'Model-edge clearance', '1', '0.1', 'mm', '20', '0.2')}
            ${numberField('zone-floor', 'Minimum solid floor', '0.8', '0.1', 'mm', '20', '0.2')}
            ${numberField('ski-run-width', 'Default width for ski centerlines', '30', '1', 'm', '500', '1')}
          </details>
        </section>
        <section class="panel" data-fit-only><h3>Insert fit</h3>
          ${numberField('fit-clearance', 'Pocket clearance per side', '0.15', '0.05', 'mm', '2')}
          ${numberField('insert-depth', 'Line insert depth', '2', '0.1', 'mm', '20', '0.2')}
          ${numberField('zone-depth', 'Area insert depth', '0.8', '0.1', 'mm', '20', '0.2')}
          <p class="help" id="fit-guidance"></p>
          <details class="setting-group"><summary>Advanced insert fit</summary>
            ${numberField('foot-relief', 'Elephant-foot relief per side', '0.18', '0.01', 'mm', '2')}
            ${numberField('foot-height', 'Elephant-foot taper height', '0.4', '0.1', 'mm', '5')}
            ${numberField('draft-angle', 'Insert draft angle', '1.5', '0.25', '°', '10')}
            ${numberField('draft-height', 'Maximum draft taper height', '1.7', '0.1', 'mm', '5')}
            ${numberField('insert-gap', 'Insert gap', '0.5', '0.1', 'mm', '20', '0.05')}
            <label class="section-label" for="terrain-island-width">Minimum terrain island width</label><div class="input-wrap"><input id="terrain-island-width" type="number" min="0" max="20" step="0.05" placeholder="Auto"/><span>mm</span></div><p class="help" id="terrain-island-guidance"></p>
            <label class="section-label" for="segment">Insert segmentation</label><select id="segment"><option value="">Full model</option><option value="50">50 × 50 mm sections</option><option value="100">100 × 100 mm sections</option></select>
            <p class="help" id="fit-mode-guidance"></p>
          </details>
          <button class="btn full-width" data-command="download-calibration">Fit calibration…</button>
        </section>
      </div>
      <div id="tab-inspect" class="hidden"><section class="panel"><h3>Generated model</h3>
        <div id="asset-summary" class="empty-note">Generate the model to inspect parts and export geometry.</div>
        <dl class="inspection-metrics"><dt>Preview terrain triangles</dt><dd id="triangle-count">—</dd></dl>
        <div id="review-controls" class="hidden"><label class="section-label" for="explode">Explode inserts</label><input id="explode" type="range" min="0" max="40" step="1" value="0"/><label class="section-label" for="section">Section view</label><input id="section" type="range" min="0" max="100" value="100"/><h4>Parts</h4><div class="review-list" id="piece-list"></div></div>
      </section></div>
    </div>
  </aside>
  <button id="mobile-scrim" class="mobile-scrim" aria-label="Close settings" hidden></button>
  <main class="stage">
    <button id="mobile-settings" class="mobile-only btn" aria-controls="settings-panel" aria-expanded="false">Settings</button>
    <div id="viewport" aria-label="Interactive 3D terrain model"></div>
    <div class="stage-top"><div class="project-heading"><h2 id="project-title">Post Canyon</h2><p id="project-subtitle"></p></div>
      <div class="mode-switch"><button id="mode-design" class="active">Edit</button><button id="mode-review" disabled aria-describedby="inspection-reason">Inspect</button></div>
      <span id="inspection-reason" class="sr-only">Generate the model to enable inspection.</span>
    </div>
    <div id="status" class="status" role="status" aria-live="polite"></div>
    <div class="floating-tools">
      <button class="tool" id="fit-view" title="Fit model" aria-label="Fit model">${icon('maximize')}</button><button class="tool" id="top-view" title="Top view" aria-label="Top view">${icon('compass')}</button>
      <div class="tool-separator"></div>
      <button class="tool active" id="contours" title="Contours" aria-label="Contours" aria-pressed="true">${icon('layers')}</button><button class="tool active" id="topo-map" title="Basemap" aria-label="Basemap" aria-pressed="true">${icon('map-pin')}</button><button class="tool" id="wireframe" title="Wireframe" aria-label="Wireframe" aria-pressed="false">${icon('grid-2-x2')}</button>
      <div class="tool-separator"></div><button class="tool" id="draw-boundary" title="Edit model area" aria-label="Edit model area">${icon('scissors')}</button>
    </div>
    <button class="compass" id="north-up" title="North up" aria-label="North up"><span>N</span><span id="north-arrow">↑</span></button>
    <div id="boundary-actions" class="hidden"><span id="boundary-count">Click terrain to place boundary vertices</span><button class="btn" id="boundary-apply">Apply</button><button class="btn" id="boundary-clear">Clear</button><button class="btn ghost" id="boundary-cancel">Cancel</button></div>
    <div class="stage-bottom"><div class="model-info"><span id="model-caption">Loading terrain</span><span><strong id="dimensions">— mm</strong> footprint</span><span><strong id="enabled-count">—</strong> included features</span></div>
      <div class="model-actions"><button class="btn ghost hidden" id="cancel-job">Cancel</button><button class="btn primary" id="generate" disabled>Generate model</button><button class="btn" id="download" disabled aria-describedby="export-reason">Export model…</button></div>
    </div>
    <p id="export-reason" class="command-reason">Generate the model to enable export.</p>
    <div class="attribution"><span id="topo-attribution"></span> · <a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS / Copernicus elevation</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div>
  </main>
</div>`;
}

/** Render focused source management and help dialogs. Native dialogs provide focus containment. */
export function renderWorkbenchDialogs() {
  return `
<dialog id="sources-dialog" class="utility-dialog" aria-labelledby="sources-title"><div class="dialog-heading"><h2 id="sources-title">Add features and manage sources</h2><button class="btn" data-close-dialog>Close</button></div>
  <label class="section-label" for="feature-source">Feature source</label><select id="feature-source"></select><p class="help" id="source-description"></p>
  <fieldset id="source-classes" class="source-class-options"></fieldset><p class="help">Load or refresh the selected classes. Other loaded classes are retained.</p>
  <button class="btn primary" id="fetch-osm">Load source</button><button class="small-link hidden" id="cancel-feature-source">Cancel source download</button>
  <div class="source-actions"><button class="small-link" id="source-new">Add source</button><button class="small-link hidden" id="source-edit">Edit</button><button class="small-link hidden" id="source-remove">Remove from library</button></div>
  <details id="source-editor"><summary>Custom source details</summary><form id="source-form"><label for="custom-source-name">Source name</label><input id="custom-source-name" required maxlength="100" placeholder="Local trail network"/><label for="source-url">GeoJSON or ArcGIS layer URL</label><input id="source-url" required type="url" maxlength="4096" placeholder="https://example.org/trails.geojson"/>
  <label for="source-class">Feature type</label><select id="source-class"><option value="auto">Automatic · use source tags</option><option value="trail">Trails</option><option value="road">Roads</option><option value="stream">Streams</option><option value="water">Water areas</option><option value="glacier">Glaciers</option><option value="ski_run">Ski runs</option><option value="ski_lift">Ski lifts</option></select>
  <label for="source-name-field">Name field (optional)</label><input id="source-name-field" maxlength="100" placeholder="Uses name, Name, or Trail_Name"/><p class="help">Use a public HTTPS endpoint that allows browser access. GeoJSON must use longitude/latitude. Optional {bbox} inserts west,south,east,north in the URL. Choose a feature type if the data has no recognizable tags. Only lines and polygons are supported.</p><button id="source-save" class="btn" type="submit">Save source</button></form></details>
  <p class="help" id="source-message" role="status" aria-live="polite"></p>
  <p class="help" id="source-progress" role="status" aria-live="polite"></p>
  <section><h3>Import files</h3><button class="btn" id="upload-gpx">Import GPX…</button><button class="btn" id="upload-features">Import GeoJSON…</button><p class="help">GPX tracks and routes are imported as trails and clipped to the model area.</p></section>
  <section id="loaded-sources"></section>
</dialog>
<dialog id="help-dialog" class="utility-dialog" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">Workbench help</h2><button class="btn" data-close-dialog>Close</button></div>
  <h3>Navigation</h3><p>Drag to orbit, right-drag or two-finger drag to pan, and scroll or pinch to zoom. Click a feature to select it. Use View → Fit model to reset the camera.</p>
  <h3>Model workflow</h3><p>Edit terrain and features, choose Print setup, then Generate model. Inspect the generated parts before Export model. After an edit, generate again to update the exported geometry.</p>
  <h3>Feature inclusion</h3><p>Feature checkboxes control inclusion in both the preview and the generated model. Select a class, source group, or feature to edit its properties. Bulk actions show their scope; group checkboxes affect all members, including features hidden by search.</p>
  <h3>Terminology</h3><dl><dt>Vertical exaggeration</dt><dd>Height scale relative to the horizontal model scale. 1× preserves proportions.</dd><dt>Pocket clearance</dt><dd>Extra space on each side of an insert so it fits its terrain pocket.</dd><dt>Draft angle</dt><dd>Angle of the insert's lower taper, limited by the maximum draft taper height.</dd><dt>Elephant-foot relief</dt><dd>Extra clearance at the bottom of an insert for first-layer expansion.</dd><dt>V-carve</dt><dd>A V-shaped groove cut into terrain.</dd><dt>Attached label platform</dt><dd>A flat extension attached to a model edge for text or a logo.</dd></dl>
  <section id="storage-help" tabindex="-1"><h3>Storage and offline use</h3><p>Edits are saved in this browser on this device. File → Export project creates a portable backup with editable terrain and features. Clearing browser data can remove local projects.</p><p>Install from your browser menu, or on iPhone and iPad choose Share → Add to Home Screen. Once offline setup finishes, local projects can be edited, generated, and exported offline. New terrain, map tiles, sources, and example downloads require a connection.</p><button class="btn hidden" id="install-app">Install app</button><p class="help" id="pwa-status" role="status" aria-live="polite"></p></section>
</dialog>`;
}

/** Browser application composition, UI state, persistence, and worker orchestration. */
import { AnnotationEditor } from './annotation-editor';
import { renderAppShell } from './app-shell';
import { downloadFile, projectFileStem, readSelectedFile } from './project-files';
import './style.css';
import {
  createIcons,
  Mountain,
  Layers,
  SlidersHorizontal,
  MapPin,
  FolderOpen,
  Download,
  Save,
  Search,
  Plus,
  Minus,
  Maximize,
  Compass,
  Box,
  Eye,
  Grid2X2,
  Check,
  ChevronRight,
  Upload,
  RotateCcw,
  Scissors,
  MousePointer2,
  ArrowUpRight,
  LoaderCircle,
  MoveUpRight,
  Info,
  X,
  CheckCheck,
} from 'lucide';
import { extentPolygon, type Shape } from './extent-shapes';
import { ExtentMap } from './extent-map';
import { polygonBounds, validatePolygon, type Vertex } from './polygon';
import { previewBoundary, previewLayout } from './preview-layout';
import { Viewer } from './viewer';
import { Engine } from './client';
import { ExportClient } from './export-client';
import { browserBuildMemoryBudgetMb } from './memory-plan';
import type { ExportFormat } from './export-formats';
import { automaticProduct } from './source-resolution';
import {
  extrusionWidthMm,
  minimumTerrainIslandWidthMm,
  recommendedInsertWidthMm,
} from './insert-fit';
import { loadPresetCatalog, loadPreset, presetUrl, type PresetEntry } from './presets';
import { loadElevation, loadLocalRaster, loadOsm, checkBounds } from './providers';
import {
  deleteLocalProject,
  duplicateLocalProject,
  listLocalProjects,
  loadLocalProject,
  newLocalProjectIdentity,
  readProjectThumbnail,
  renameLocalProject,
  requestPersistentProjectStorage,
  saveLocalProject,
  writeProjectThumbnail,
  type LocalProjectIdentity,
  type LocalProjectSummary,
} from './project-store';
import {
  defaults,
  normalizeSettings,
  type Project,
  type Settings,
  type Terrain,
  type Overlay,
  type Asset,
  type Feature,
  type Treatment,
  type Bounds,
  type Product,
  type Grid,
  type Source,
} from './types';
const icons = {
  Mountain,
  Layers,
  SlidersHorizontal,
  MapPin,
  FolderOpen,
  Download,
  Save,
  Search,
  Plus,
  Minus,
  Maximize,
  Compass,
  Box,
  Eye,
  Grid2X2,
  Check,
  ChevronRight,
  Upload,
  RotateCcw,
  Scissors,
  MousePointer2,
  ArrowUpRight,
  LoaderCircle,
  MoveUpRight,
  Info,
  X,
  CheckCheck,
};
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
$('app').innerHTML = renderAppShell(icon);
createIcons({ icons });
function mobileSettings(open: boolean) {
  document.body.classList.toggle('settings-open', open);
  $('mobile-settings').setAttribute('aria-expanded', String(open));
  $('mobile-scrim').hidden = !open;
  document.querySelector<HTMLElement>('.stage')!.inert = open;
  document.querySelector<HTMLElement>('header')!.inert = open;
  if (open) $('mobile-close').focus();
  else $('mobile-settings').focus();
}
$('mobile-settings').onclick = () => mobileSettings(true);
$('mobile-close').onclick = () => mobileSettings(false);
$('mobile-scrim').onclick = () => mobileSettings(false);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('settings-open'))
    mobileSettings(false);
});
document.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('#ann-place') && matchMedia('(max-width:760px)').matches)
    mobileSettings(false);
});
matchMedia('(max-width:760px)').addEventListener('change', () => mobileSettings(false));
$('show-projects').setAttribute('aria-label', 'Projects');
$('open-project').setAttribute('aria-label', 'Open project');
$('save-project').setAttribute('aria-label', 'Export project');

let viewer: Viewer;
try {
  viewer = new Viewer($('viewport'));
} catch (e) {
  $('status').textContent =
    'WebGL is unavailable. Enable hardware acceleration or use a supported browser.';
  throw e;
}
const engine = new Engine();
const exportClient = new ExportClient();
let project: Project;
let terrain: Terrain;
let overlays: Overlay[] = [];
let asset: Asset | undefined;
let revision = 0;
let busy = false;
let exportRunning = false;
let mode: 'design' | 'review' = 'design';
let selected: string | null = null;
let abort = new AbortController();
let overlayTimer: ReturnType<typeof setTimeout>;
let overlayRunning = false;
let overlayAgain = false;
let previewSuspended = false;
type PreviewStage = 'topo' | 'terrain' | 'features';
let previewStage: PreviewStage | undefined;
let previewStageHistory: PreviewStage[] = [];
let boundaryPoints: [number, number][] = [];
let terrainBuilds = 0;
let selectedBounds: Bounds | undefined;
let selectedBoundary: Vertex[] = [];
let extentMap: ExtentMap;
let polygonValid = false;
let winterRestore = new Map<string, { enabled: boolean; treatment: Treatment }>();
let presetEntries: PresetEntry[] = [];
let wizardMode = false;
let wizardStep = 1;
let localIdentity: LocalProjectIdentity | undefined;
let presetOriginId: string | undefined;
let savedTerrainGrid: Grid | undefined;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveQueue: Promise<void> = Promise.resolve();
let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
let thumbnailDirty = false;
let persistenceRequested = false;
let landingThumbnailUrls: string[] = [];
const newProjectBounds: Bounds = [-121.668, 45.681, -121.655, 45.69];
const annotationEditor = new AnnotationEditor(
  viewer,
  () => ({ project, terrain }),
  () => touch(),
  () => setPanel('annotations'),
);
function status(message: string, error = false, loading = false) {
  $('status').classList.toggle('error', error);
  $('status').innerHTML =
    (loading ? '<span class="spinner"></span>' : '') + `<span>${esc(message)}</span>`;
  if (!message) $('status').innerHTML = '';
}
function nextPreviewPaint() {
  return new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
function markPreviewStage(stage: PreviewStage, reset = false) {
  if (reset) previewStageHistory = [];
  previewStage = stage;
  if (previewStageHistory.at(-1) !== stage) previewStageHistory.push(stage);
}
function showProjectLoadingPreview() {
  const bounds = project.grid.bounds;
  const boundary: [number, number][] =
    project.settings.boundary?.length >= 3
      ? project.settings.boundary
      : [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[1]],
          [bounds[2], bounds[3]],
          [bounds[0], bounds[3]],
        ];
  const layout = previewLayout(bounds, project.settings);
  const projected = previewBoundary(layout, boundary);
  const first = projected[0],
    last = projected.at(-1),
    closed =
      first && last && (first[0] !== last[0] || first[1] !== last[1])
        ? [...projected, first]
        : projected;
  viewer.showLoadingMap(layout, closed);
  markPreviewStage('topo', true);
  $('model-caption').textContent = 'PROJECT AREA \u00b7 LOADING TOPO AND ELEVATION';
}
function updateBusy(v: boolean) {
  busy = v;
  ($('generate') as HTMLButtonElement).disabled = v || !terrain;
  ($('load-area') as HTMLButtonElement).disabled = v;
  ($('fetch-osm') as HTMLButtonElement).disabled = v;
  ($('download-calibration') as HTMLButtonElement).disabled = v;
  ($('area-load') as HTMLButtonElement).disabled = v || !polygonValid;
  $('cancel-job').classList.toggle('hidden', !v);
}
function error(e: unknown) {
  status(e instanceof Error ? e.message : String(e), true);
}
function activateNewLocalWorkspace(originPresetId?: string) {
  localIdentity = newLocalProjectIdentity(originPresetId);
  presetOriginId = undefined;
  savedTerrainGrid = undefined;
  thumbnailDirty = true;
}
function activateStoredWorkspace(summary: LocalProjectSummary) {
  localIdentity = {
    id: summary.id,
    created_at_ms: summary.created_at_ms,
    origin_preset_id: summary.origin_preset_id,
  };
  presetOriginId = undefined;
  savedTerrainGrid = project.grid;
  thumbnailDirty = false;
}
function activatePresetWorkspace(id: string) {
  localIdentity = undefined;
  presetOriginId = id;
  savedTerrainGrid = undefined;
  thumbnailDirty = false;
}
function ensureLocalIdentity() {
  if (!localIdentity) activateNewLocalWorkspace(presetOriginId);
  return localIdentity!;
}
async function persistCurrentProject() {
  if (!project || !localIdentity) return;
  const identity = localIdentity,
    snapshot = project,
    writeTerrain = savedTerrainGrid !== snapshot.grid;
  try {
    const durable = await saveLocalProject(snapshot, {
      ...identity,
      write_terrain: writeTerrain,
    });
    if (localIdentity?.id === identity.id && project === snapshot) {
      savedTerrainGrid = snapshot.grid;
      $('save-status').textContent = durable ? 'Saved locally' : 'Saved for this tab';
    }
    if (durable && !persistenceRequested) {
      persistenceRequested = true;
      void requestPersistentProjectStorage();
    }
  } catch (e) {
    if (localIdentity?.id === identity.id)
      $('save-status').textContent = 'Local save failed · export a backup';
    console.error(e);
  }
}
function queueAutosave() {
  autosaveQueue = autosaveQueue.catch(() => undefined).then(persistCurrentProject);
  return autosaveQueue;
}
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = undefined;
    void queueAutosave();
  }, 900);
}
async function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    await queueAutosave();
  }
  await autosaveQueue;
}
async function captureThumbnail(force = false) {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = undefined;
  if (!localIdentity || !terrain || busy || (!thumbnailDirty && !force)) return;
  const id = localIdentity.id;
  try {
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const thumbnail = await viewer.createThumbnail();
    if (thumbnail.size && localIdentity?.id === id) {
      await writeProjectThumbnail(id, thumbnail);
      thumbnailDirty = false;
    }
  } catch (e) {
    console.warn('Project thumbnail could not be generated.', e);
  }
}
function scheduleThumbnail() {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => void captureThumbnail(), 2200);
}
function touch() {
  revision++;
  ensureLocalIdentity();
  thumbnailDirty = true;
  $('save-status').textContent = 'Saving locally…';
  scheduleAutosave();
  scheduleThumbnail();
  ($('download') as HTMLButtonElement).disabled = true;
  ($('mode-review') as HTMLButtonElement).disabled = true;
  if (asset)
    $('asset-summary').innerHTML =
      '<p class="empty-note">The design changed. Generate again to review and download the current model.</p>';
  asset = undefined;
  if (mode === 'review') design();
}
function refreshMetrics() {
  if (terrain) {
    $('dimensions').innerHTML =
      `${terrain.layout.width.toFixed(1)} × ${terrain.layout.depth.toFixed(1)} <small>mm</small>`;
    $('triangle-count').textContent = (terrain.mesh.indices.length / 3).toLocaleString();
  }
  $('enabled-count').textContent =
    project?.features.filter(f => f.enabled).length.toString() || '0';
  $('feature-count').textContent = project?.features.length.toString() || '0';
}
function setPanel(name: string) {
  document
    .querySelectorAll('[data-tab]')
    .forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.tab === name));
  ['terrain', 'features', 'annotations', 'print'].forEach(n =>
    $(`tab-${n}`).classList.toggle('hidden', n !== name),
  );
}
function showLanding() {
  const dialog = $('landing-dialog');
  dialog.classList.remove('hidden');
  document.querySelector<HTMLElement>('.workspace')!.inert = true;
  document.querySelector<HTMLElement>('header')!.inert = true;
}
function hideLanding() {
  $('landing-dialog').classList.add('hidden');
  document.querySelector<HTMLElement>('.workspace')!.inert = false;
  document.querySelector<HTMLElement>('header')!.inert = false;
}
function recentTime(timestamp: number) {
  const elapsed = Date.now() - timestamp,
    day = 24 * 60 * 60 * 1000;
  if (elapsed < 60_000) return 'Edited just now';
  if (elapsed < 60 * 60 * 1000)
    return `Edited ${Math.max(1, Math.floor(elapsed / 60_000))} min ago`;
  if (elapsed < day) return `Edited ${Math.max(1, Math.floor(elapsed / (60 * 60 * 1000)))} hr ago`;
  if (elapsed < day * 7) {
    const days = Math.floor(elapsed / day);
    return `Edited ${days} day${days === 1 ? '' : 's'} ago`;
  }
  return `Edited ${new Date(timestamp).toLocaleDateString()}`;
}
async function renderLanding() {
  landingThumbnailUrls.forEach(URL.revokeObjectURL);
  landingThumbnailUrls = [];
  let recent: LocalProjectSummary[] = [];
  try {
    recent = await listLocalProjects();
  } catch (e) {
    console.warn('Recent projects could not be listed.', e);
  }
  const thumbnails = await Promise.all(
    recent.map(async item => {
      try {
        const blob = await readProjectThumbnail(item.id);
        if (!blob) return '';
        const url = URL.createObjectURL(blob);
        landingThumbnailUrls.push(url);
        return url;
      } catch {
        return '';
      }
    }),
  );
  $('recent-section').classList.toggle('hidden', !recent.length);
  $('recent-grid').innerHTML = recent
    .map((item, index) => {
      const image = thumbnails[index]
        ? `<img src="${esc(thumbnails[index])}" alt="Preview of ${esc(item.name)}"/>`
        : `<span class="project-placeholder">${icon('mountain')}</span>`;
      return `<article class="preset-card local-project-card" data-local-project="${esc(item.id)}"><button class="local-project-open" data-local-open="${esc(item.id)}" aria-label="Open ${esc(item.name)}">${image}<span class="preset-copy"><strong>${esc(item.name)}</strong><small>${esc(item.source_name)}</small><span>${recentTime(item.updated_at_ms)}</span><span class="preset-badges"><b>${item.feature_count.toLocaleString()} features</b>${localIdentity?.id === item.id ? '<b>Open</b>' : ''}</span></span></button><div class="local-project-actions"><button data-local-rename="${esc(item.id)}">Rename</button><button data-local-copy="${esc(item.id)}">Duplicate</button><button data-local-export="${esc(item.id)}">Export</button><button data-local-delete="${esc(item.id)}">Delete</button></div></article>`;
    })
    .join('');
  $('preset-grid').innerHTML =
    presetEntries
      .map(
        entry =>
          `<button class="preset-card" data-preset="${esc(entry.id)}" aria-label="Open ${esc(entry.name)}"><img src="${esc(presetUrl(entry.image))}" alt="" loading="eager"/><span class="preset-copy"><strong>${esc(entry.name)}</strong><small>${esc(entry.location)}</small><span>${esc(entry.description)}</span><span class="preset-badges">${entry.badges.map(b => `<b>${esc(b)}</b>`).join('')}</span></span></button>`,
      )
      .join('') +
    `<button class="preset-card preset-new" id="preset-new" aria-label="Create a new landscape"><span class="new-model-icon">${icon('plus')}</span><span class="preset-copy"><strong>New landscape</strong><small>Choose any place</small><span>Draw a custom boundary and follow the guided setup.</span><span class="preset-badges"><b>3-step wizard</b></span></span></button>`;
  createIcons({ icons });
  $('preset-grid')
    .querySelectorAll<HTMLElement>('[data-preset]')
    .forEach(
      card =>
        (card.onclick = () => {
          const entry = presetEntries.find(item => item.id === card.dataset.preset);
          if (entry) void openPresetModel(entry);
        }),
    );
  $('recent-grid')
    .querySelectorAll<HTMLButtonElement>('[data-local-open]')
    .forEach(button => (button.onclick = () => void openLocalWorkspace(button.dataset.localOpen!)));
  $('recent-grid')
    .querySelectorAll<HTMLButtonElement>('[data-local-rename]')
    .forEach(
      button =>
        (button.onclick = async () => {
          const item = recent.find(value => value.id === button.dataset.localRename);
          if (!item) return;
          const name = prompt('Project name', item.name)?.trim();
          if (!name || name === item.name) return;
          await renameLocalProject(item.id, name);
          if (localIdentity?.id === item.id) {
            project.name = name;
            projectLabels();
          }
          await renderLanding();
        }),
    );
  $('recent-grid')
    .querySelectorAll<HTMLButtonElement>('[data-local-copy]')
    .forEach(
      button =>
        (button.onclick = async () => {
          await duplicateLocalProject(button.dataset.localCopy!);
          await renderLanding();
        }),
    );
  $('recent-grid')
    .querySelectorAll<HTMLButtonElement>('[data-local-export]')
    .forEach(
      button =>
        (button.onclick = async () => {
          const loaded = await loadLocalProject(button.dataset.localExport!);
          if (!loaded) return;
          downloadFile(
            JSON.stringify(loaded.project),
            projectFileStem(loaded.project.name) + '.contour.json',
            'application/json',
          );
        }),
    );
  $('recent-grid')
    .querySelectorAll<HTMLButtonElement>('[data-local-delete]')
    .forEach(
      button =>
        (button.onclick = async () => {
          const item = recent.find(value => value.id === button.dataset.localDelete);
          if (!item || !confirm(`Delete “${item.name}” from this device?`)) return;
          await deleteLocalProject(item.id);
          if (localIdentity?.id === item.id) {
            localIdentity = undefined;
            presetOriginId = undefined;
            savedTerrainGrid = undefined;
          }
          await renderLanding();
        }),
    );
  $('preset-new').onclick = async () => {
    await flushAutosave();
    hideLanding();
    openArea(true);
  };
}
async function openLanding() {
  if (busy) {
    abort.abort();
    engine.cancel();
    updateBusy(false);
  }
  await flushAutosave();
  if (thumbnailDirty) await captureThumbnail();
  await renderLanding();
  showLanding();
}
async function openLocalWorkspace(id: string) {
  await flushAutosave();
  updateBusy(true);
  status('Opening local project…', false, true);
  try {
    const loaded = await loadLocalProject(id);
    if (!loaded) throw new Error('This local project is no longer available.');
    project = { ...loaded.project, settings: normalizeSettings(loaded.project.settings) };
    activateStoredWorkspace(loaded.summary);
    asset = undefined;
    revision = 0;
    terrainBuilds = 0;
    selected = null;
    winterRestore.clear();
    mode = 'design';
    hideLanding();
    $('area-dialog').classList.add('hidden');
    projectLabels();
    syncForm();
    listFeatures();
    viewer.model.scale.z = 1;
    showProjectLoadingPreview();
    await nextPreviewPaint();
    await rebuild(true, true, false, false, true);
    setPanel('terrain');
    $('save-status').textContent = 'Saved locally';
    status('');
  } catch (e) {
    error(e);
    showLanding();
  } finally {
    updateBusy(false);
  }
}

async function openPresetModel(entry: PresetEntry) {
  await flushAutosave();
  updateBusy(true);
  $('preset-grid').classList.add('loading');
  status(`Opening ${entry.name}…`, false, true);
  try {
    const bundle = await loadPreset(entry);
    project = { ...bundle.project, settings: normalizeSettings(bundle.project.settings) };
    activatePresetWorkspace(entry.id);
    terrain = bundle.terrain;
    overlays = bundle.overlays;
    asset = undefined;
    revision = 0;
    terrainBuilds = 0;
    selected = null;
    winterRestore.clear();
    mode = 'design';
    projectLabels();
    syncForm();
    listFeatures();
    viewer.model.scale.z = 1;
    hideLanding();
    showProjectLoadingPreview();
    await nextPreviewPaint();
    viewer.setTerrain(terrain.mesh, terrain.layout, true);
    markPreviewStage('terrain');
    status('Terrain ready. Adding map features...', false, true);
    $('model-caption').textContent = 'TERRAIN READY \u00b7 LOADING MAP FEATURES';
    await nextPreviewPaint();
    viewer.setOverlays(overlays, project.features, project.settings);
    if (overlays.length) markPreviewStage('features');
    annotationEditor.refresh();
    refreshMetrics();
    $('model-caption').textContent = 'DESIGN PREVIEW · PREBUILT';
    ($('generate') as HTMLButtonElement).disabled = false;
    ($('download') as HTMLButtonElement).disabled = true;
    ($('mode-review') as HTMLButtonElement).disabled = true;
    $('save-status').textContent = 'Example · edit to save';
    setPanel('terrain');
    status('');
    void engine.call('hydrate', { project, terrain }).catch(error);
  } catch (e) {
    error(e);
    showLanding();
  } finally {
    $('preset-grid').classList.remove('loading');
    updateBusy(false);
  }
}

document
  .querySelectorAll('[data-tab]')
  .forEach(e => e.addEventListener('click', () => setPanel((e as HTMLElement).dataset.tab!)));
const featureClasses: Feature['class'][] = [
  'trail',
  'road',
  'stream',
  'water',
  'glacier',
  'ski_run',
  'ski_lift',
];
const classLabels: Record<Feature['class'], string> = {
  trail: 'Trails',
  road: 'Roads',
  stream: 'Waterways',
  water: 'Lakes & rivers',
  glacier: 'Glaciers',
  ski_run: 'Ski runs',
  ski_lift: 'Ski lifts',
};
const zoneFeature = (f: Feature) =>
  Boolean(f.polygons?.length) || (['water', 'glacier', 'ski_run'] as string[]).includes(f.class);
const treatment = (f: Feature): Treatment => (f.treatment === 'v_carve' ? 'v_carve' : 'insert');
const treatmentOptions = (value: string, mixed = false, zone = false) =>
  (mixed ? '<option value="mixed">Mixed</option>' : '') +
  (['insert', 'v_carve'] as Treatment[])
    .map(
      v =>
        `<option value="${v}" ${v === value ? 'selected' : ''}>${v === 'insert' ? 'Insert' : zone ? 'Recess' : 'V-carve'}</option>`,
    )
    .join('');
function setTreatment(features: Feature[], value: Treatment) {
  for (const f of features) {
    f.treatment = value;
    viewer.toggle(f.id, f.enabled);
  }
  touch();
  refreshMetrics();
  listFeatures();
  void updateOverlays();
}
function featureOptions(f: Feature) {
  if (!zoneFeature(f) || selected !== f.id) return '';
  const width =
    f.class === 'ski_run' && !f.polygons?.length
      ? `<label>Run width <span class="input-wrap"><input data-width="${esc(f.id)}" type="number" min="1" max="500" step="1" value="${f.width_m ?? project.settings.ski_run_width_m}"/><span>m</span></span></label>`
      : '';
  return `<div class="zone-options"><label>Surface <select data-surface="${esc(f.id)}"><option value="terrain" ${f.surface !== 'level' ? 'selected' : ''}>Follow terrain</option><option value="level" ${f.surface === 'level' ? 'selected' : ''}>Level surface</option></select></label><label>Insert depth <span class="input-wrap"><input data-zone-depth="${esc(f.id)}" type="number" min="0.2" max="20" step="0.1" value="${f.insert_depth_mm ?? project.settings.zone_insert_depth_mm}"/><span>mm</span></span></label>${width}<p>Shallow pocket · continuous supporting floor</p></div>`;
}
function listFeatures() {
  if (!project) return;
  const term = ($('feature-search') as HTMLInputElement).value.toLowerCase();
  $('feature-list').innerHTML =
    featureClasses
      .map(cls => {
        const all = project.features.filter(f => f.class === cls),
          list = all.filter(f => `${f.name} ${f.id}`.toLowerCase().includes(term));
        if (!list.length) return '';
        const modes = new Set(all.map(treatment));
        const value = modes.size === 1 ? treatment(all[0]) : 'mixed';
        const label = classLabels[cls],
          zone = all.some(zoneFeature);
        return `<div class="feature-group"><div class="group-heading"><input type="checkbox" data-class="${cls}" aria-label="Show ${label}" ${all.every(f => f.enabled) ? 'checked' : ''}/><span>${label}</span><small>${all.length}</small><select data-class-treatment="${cls}" aria-label="${label} treatment">${treatmentOptions(value, modes.size > 1, zone)}</select></div>${list.map(f => `<div class="feature-entry ${f.id === selected ? 'selected' : ''}" data-feature="${esc(f.id)}"><div class="feature-item"><input type="checkbox" data-toggle="${esc(f.id)}" aria-label="Show ${esc(f.name)}" ${f.enabled ? 'checked' : ''}/><span title="${esc(f.name)}">${esc(f.name)}</span><select data-treatment="${esc(f.id)}" aria-label="Treatment for ${esc(f.name)}">${treatmentOptions(treatment(f), false, zoneFeature(f))}</select></div>${featureOptions(f)}</div>`).join('')}</div>`;
      })
      .join('') || '<p class="empty-note">No matching features.</p>';
  $('feature-list')
    .querySelectorAll<HTMLInputElement>('[data-toggle]')
    .forEach(
      input =>
        (input.onchange = () =>
          setVisibility(
            [project.features.find(f => f.id === input.dataset.toggle)!],
            input.checked,
          )),
    );
  $('feature-list')
    .querySelectorAll<HTMLInputElement>('[data-class]')
    .forEach(input => {
      const items = project.features.filter(f => f.class === input.dataset.class);
      input.indeterminate = items.some(f => f.enabled) && !items.every(f => f.enabled);
      input.onchange = () => setVisibility(items, input.checked);
    });
  $('feature-list')
    .querySelectorAll<HTMLSelectElement>('[data-treatment]')
    .forEach(
      input =>
        (input.onchange = () =>
          setTreatment(
            [project.features.find(f => f.id === input.dataset.treatment)!],
            input.value as Treatment,
          )),
    );
  $('feature-list')
    .querySelectorAll<HTMLSelectElement>('[data-class-treatment]')
    .forEach(
      input =>
        (input.onchange = () => {
          if (input.value !== 'mixed')
            setTreatment(
              project.features.filter(f => f.class === input.dataset.classTreatment),
              input.value as Treatment,
            );
        }),
    );
  $('feature-list')
    .querySelectorAll<HTMLElement>('[data-feature]')
    .forEach(
      row =>
        (row.onclick = e => {
          if ((e.target as HTMLElement).closest('input,select,button')) return;
          selected = row.dataset.feature!;
          viewer.highlight(selected);
          listFeatures();
        }),
    );
  $('feature-list')
    .querySelectorAll<HTMLSelectElement>('[data-surface]')
    .forEach(
      input =>
        (input.onchange = () => {
          const f = project.features.find(f => f.id === input.dataset.surface)!;
          f.surface = input.value as Feature['surface'];
          touch();
          void updateOverlays();
        }),
    );
  $('feature-list')
    .querySelectorAll<HTMLInputElement>('[data-width]')
    .forEach(
      input =>
        (input.onchange = () => {
          const f = project.features.find(f => f.id === input.dataset.width)!;
          f.width_m = Number(input.value);
          touch();
          void updateOverlays();
        }),
    );
  $('feature-list')
    .querySelectorAll<HTMLInputElement>('[data-zone-depth]')
    .forEach(
      input =>
        (input.onchange = () => {
          const f = project.features.find(f => f.id === input.dataset.zoneDepth)!;
          f.insert_depth_mm = Number(input.value);
          touch();
        }),
    );
}
function setVisibility(features: Feature[], enabled: boolean) {
  features.forEach(f => {
    f.enabled = enabled;
    if (f.treatment === 'hide') f.treatment = 'insert';
    viewer.toggle(f.id, enabled);
  });
  touch();
  refreshMetrics();
  listFeatures();
  void updateOverlays();
}
function setWinterMode(enabled: boolean) {
  if (!project) return;
  project.winter_mode = enabled;
  if (enabled) {
    winterRestore = new Map(
      project.features.map(f => [f.id, { enabled: f.enabled, treatment: treatment(f) }]),
    );
    for (const f of project.features) {
      if (f.class === 'trail') f.enabled = false;
      if (['glacier', 'ski_run', 'ski_lift'].includes(f.class)) {
        f.enabled = true;
        f.treatment = f.class === 'ski_lift' ? 'v_carve' : 'insert';
      }
    }
  } else {
    for (const f of project.features) {
      const prior = winterRestore.get(f.id);
      if (prior) {
        f.enabled = prior.enabled;
        f.treatment = prior.treatment;
      }
    }
    winterRestore.clear();
  }
  touch();
  refreshMetrics();
  listFeatures();
  void updateOverlays();
}
$('winter-mode').onchange = () => {
  const enabled = ($('winter-mode') as HTMLInputElement).checked;
  setWinterMode(enabled);
  if (enabled && !project.features.some(f => f.class === 'ski_run' || f.class === 'ski_lift'))
    $('fetch-osm').click();
};
$('feature-search').addEventListener('input', listFeatures);
$('all-features').onclick = () =>
  setVisibility(project.features, !project.features.every(f => f.enabled));
viewer.onPick = id => {
  selected = id;
  viewer.highlight(id);
  setPanel('features');
  listFeatures();
  const row = [...$('feature-list').querySelectorAll<HTMLElement>('[data-feature]')].find(
    e => e.dataset.feature === id,
  );
  row?.scrollIntoView({ block: 'nearest' });
};
function insertSurfaceDescription(settings: Settings) {
  const height = settings.insert_relative_height_mm;
  if (Math.abs(height) < 1e-9) return 'Flush · aligned to sampled terrain';
  return height < 0
    ? 'Inset · ' + Math.abs(height).toFixed(2) + ' mm below sampled terrain'
    : 'Proud · ' + height.toFixed(2) + ' mm above sampled terrain';
}
function fitGuidance() {
  const s = project.settings,
    extrusion = extrusionWidthMm(s.nozzle_diameter_mm),
    recommended = recommendedInsertWidthMm(s.nozzle_diameter_mm),
    island = minimumTerrainIslandWidthMm(s);
  $('fit-guidance').textContent =
    `${s.nozzle_diameter_mm.toFixed(2)} mm nozzle · approximately ${extrusion.toFixed(2)} mm extrusion · recommended line insert width ≥ ${recommended.toFixed(2)} mm`;
  $('terrain-island-guidance').textContent =
    s.minimum_terrain_island_width_mm === null
      ? `Auto: ${island.toFixed(2)} mm (three extrusion widths). Smaller enclosed terrain pins are removed; insert gaps stay unchanged.`
      : s.minimum_terrain_island_width_mm === 0
        ? 'Terrain pin removal is disabled.'
        : `Enclosed terrain pins narrower than ${island.toFixed(2)} mm are removed; insert gaps stay unchanged.`;
}
function syncForm() {
  const s = project.settings;
  ($('bed-width') as HTMLInputElement).value = String(s.max_print_size_mm[0]);
  ($('bed-depth') as HTMLInputElement).value = String(s.max_print_size_mm[1]);
  ($('height-factor') as HTMLInputElement).value = String(s.height_factor);
  $('height-value').textContent = s.height_factor.toFixed(2) + '×';
  for (const [id, k] of [
    ['base-height', 'base_height_mm'],
    ['nozzle-diameter', 'nozzle_diameter_mm'],
    ['path-width', 'path_width_mm'],
    ['clearance', 'path_clearance_mm'],
    ['edge-clearance', 'feature_edge_clearance_mm'],
    ['fit-clearance', 'insert_fit_clearance_per_side_mm'],
    ['foot-relief', 'insert_elephant_foot_relief_mm'],
    ['foot-height', 'insert_elephant_foot_height_mm'],
    ['draft-angle', 'insert_draft_angle_deg'],
    ['insert-depth', 'insert_depth_mm'],
    ['zone-depth', 'zone_insert_depth_mm'],
    ['zone-floor', 'zone_floor_mm'],
    ['ski-run-width', 'ski_run_width_m'],
    ['carve-depth', 'carve_depth_mm'],
    ['insert-gap', 'insert_gap_mm'],
    ['quality', 'terrain_max_error_mm'],
  ] as const)
    ($(id) as HTMLInputElement).value = String(s[k]);
  ($('terrain-island-width') as HTMLInputElement).value =
    s.minimum_terrain_island_width_mm === null ? '' : String(s.minimum_terrain_island_width_mm);
  ($('segment') as HTMLSelectElement).value = s.insert_segment_size_mm
    ? String(s.insert_segment_size_mm)
    : '';
  ($('winter-mode') as HTMLInputElement).checked = Boolean(project.winter_mode);
  ($('manufacturing-mode') as HTMLSelectElement).value = s.manufacturing_mode;
  ($('insert-relative-height') as HTMLInputElement).value = String(s.insert_relative_height_mm);

  const groups = project.materials || [
    { id: 'terrain', name: 'Terrain', color: '#8baa73', extruder: 1 },
    { id: 'features', name: 'Features', color: '#f4b45e', extruder: 2 },
  ];
  ($('terrain-color') as HTMLInputElement).value = groups[0].color;
  ($('feature-color') as HTMLInputElement).value = groups[1].color;
  ($('terrain-extruder') as HTMLInputElement).value = String(groups[0].extruder);
  ($('feature-extruder') as HTMLInputElement).value = String(groups[1].extruder);
  for (const id of ['fit-clearance', 'foot-relief', 'foot-height', 'draft-angle'])
    ($(id) as HTMLInputElement).disabled = s.manufacturing_mode === 'multicolor';
  fitGuidance();
}
function projectLabels() {
  annotationEditor.sync();
  $('location-name').textContent = project.name;
  $('project-subtitle').textContent = `${project.name} · Terrain & trail study`;
  $('project-crumb').textContent = project.name.toUpperCase();
  $('source-name').textContent = project.source.name;
  const b = project.grid.bounds;
  $('coordinates').textContent =
    `${Math.abs((b[1] + b[3]) / 2).toFixed(3)}° ${b[1] + b[3] >= 0 ? 'N' : 'S'} · ${Math.abs((b[0] + b[2]) / 2).toFixed(3)}° ${b[0] + b[2] >= 0 ? 'E' : 'W'}`;
}
async function rebuild(
  fit = false,
  includeOverlays = true,
  keepBusy = false,
  propagateError = false,
  stagedPreview = false,
) {
  if (!project) return;
  updateBusy(true);
  const requested = revision;
  try {
    const t = await engine.call(
      'terrain',
      { grid: project.grid, settings: project.settings, features: project.features },
      progress => status(progress.message, false, true),
    );
    if (requested !== revision) {
      status('Settings changed during generation. Applying the latest design…', false, true);
      updateBusy(false);
      return rebuild(fit);
    }
    terrain = t;
    terrainBuilds = t.terrainBuilds;
    viewer.model.scale.z = 1;
    viewer.setTerrain(t.mesh, t.layout, fit);
    if (stagedPreview) {
      markPreviewStage('terrain');
      $('model-caption').textContent = 'TERRAIN READY \u00b7 LOADING MAP FEATURES';
      await nextPreviewPaint();
    }
    overlays = includeOverlays
      ? await engine.call(
          'overlays',
          { features: project.features, settings: project.settings },
          progress => status(progress.message, false, true),
        )
      : [];
    viewer.setOverlays(overlays, project.features, project.settings);
    if (stagedPreview && overlays.length) markPreviewStage('features');
    annotationEditor.refresh();
    $('model-caption').textContent =
      project.settings.terrain_max_error_mm > 0
        ? `DESIGN PREVIEW · ADAPTIVE ≤ ${project.settings.terrain_max_error_mm} MM`
        : 'DESIGN PREVIEW · SOURCE RESOLUTION';
    refreshMetrics();
    status('');
    ($('generate') as HTMLButtonElement).disabled = false;
  } catch (e) {
    error(e);
    if (propagateError) throw e;
  } finally {
    if (!keepBusy) updateBusy(false);
    if (thumbnailDirty) scheduleThumbnail();
  }
}
async function updateOverlays() {
  if (!terrain) return;
  if (overlayRunning) {
    overlayAgain = true;
    return;
  }
  overlayRunning = true;
  if (!busy) status('Updating feature treatments…', false, true);
  const requested = revision;
  try {
    const result = await engine.call('overlays', {
      features: project.features,
      settings: project.settings,
    });
    if (requested === revision) {
      overlays = result;
      if (!previewSuspended) viewer.setOverlays(overlays, project.features, project.settings);
      annotationEditor.refresh();
      if (!busy) status('');
    } else overlayAgain = true;
  } catch (e) {
    error(e);
  } finally {
    overlayRunning = false;
    if (overlayAgain) {
      overlayAgain = false;
      void updateOverlays();
    } else if (thumbnailDirty) scheduleThumbnail();
  }
}
function design() {
  mode = 'design';
  $('mode-design').classList.add('active');
  $('mode-review').classList.remove('active');
  if (terrain) {
    viewer.setTerrain(terrain.mesh, terrain.layout);
    viewer.setOverlays(overlays, project.features, project.settings);
    annotationEditor.refresh();
    viewer.setSection(100);
  }
  $('model-caption').textContent = 'DESIGN PREVIEW · NOT PRINT GEOMETRY';
  $('review-controls').classList.add('hidden');
}
$('mode-design').onclick = design;
$('mode-review').onclick = () => {
  if (!asset || asset.revision !== revision) return;
  mode = 'review';
  viewer.showAsset(asset, terrain.layout);
  annotationEditor.refresh(true);
  $('mode-review').classList.add('active');
  $('mode-design').classList.remove('active');
  $('model-caption').textContent = 'GENERATED ASSET · VALIDATED SOLID';
  $('review-controls').classList.remove('hidden');
  setPanel('print');
};
$('generate').onclick = async () => {
  if (busy || !terrain) return;
  updateBusy(true);
  const requested = revision;
  const releasePreview = terrain.mesh.indices.length / 3 > 1_000_000;
  let completed = false;
  if (releasePreview) {
    previewSuspended = true;
    viewer.releaseDesignGeometry();
  }
  try {
    const result = await engine.call(
      'generate',
      {
        features: project.features,
        settings: project.settings,
        annotations: project.annotations || [],
        revision: requested,
        memory_budget_mb: browserBuildMemoryBudgetMb(),
      },
      progress => status(progress.message, false, true),
    );
    if (requested !== revision) {
      status('The design changed while generating. Generate again for the latest selection.');
      return;
    }
    asset = result;
    ($('download') as HTMLButtonElement).disabled = false;
    ($('mode-review') as HTMLButtonElement).disabled = false;
    $('asset-summary').innerHTML =
      `<div class="review-box"><strong class="check">✓ Validated solid geometry</strong><br/>${result.validation.triangles.toLocaleString()} terrain triangles<br/>${result.inserts.length} independently printable inserts<br/>${insertSurfaceDescription(project.settings)}${result.validation.removed_terrain_islands ? `<br/>${result.validation.removed_terrain_islands} unprintable terrain ${result.validation.removed_terrain_islands === 1 ? 'pin' : 'pins'} removed` : ''}</div>`;
    $('piece-list').innerHTML = result.inserts
      .map(p => `<div class="review-piece"><span>${esc(p.id)}</span></div>`)
      .join('');
    $('mode-review').click();
    completed = true;
    status(
      result.validation.removed_terrain_islands
        ? `Your model is ready. Removed ${result.validation.removed_terrain_islands} unprintable terrain ${result.validation.removed_terrain_islands === 1 ? 'pin' : 'pins'} while preserving the insert gaps.`
        : 'Your model is ready. Inspect it here or download the print bundle.',
    );
  } catch (e) {
    error(e);
  } finally {
    previewSuspended = false;
    if (releasePreview && !completed && mode === 'design') {
      viewer.setTerrain(terrain.mesh, terrain.layout);
      viewer.setOverlays(overlays, project.features, project.settings);
    }
    updateBusy(false);
  }
};
function downloadDialog(open: boolean) {
  $('download-dialog').classList.toggle('hidden', !open);
  document.querySelector<HTMLElement>('.workspace')!.inert = open;
  document.querySelector<HTMLElement>('header')!.inert = open;
  if (open) {
    const layer = Math.max(0.08, Math.min(0.32, project.settings.nozzle_diameter_mm * 0.5));
    $('bambu-export-note').textContent =
      `Bambu defaults: ${layer.toFixed(2)} mm layers, 3 walls, 4 top/bottom layers, 15% grid infill, automatic brim. Elephant-foot compensation stays off because the insert taper is built into the geometry.`;
    ($('download-confirm') as HTMLButtonElement).focus();
  }
}
$('download').onclick = () => {
  if (asset && asset.revision === revision) downloadDialog(true);
};
$('download-cancel').onclick = () => downloadDialog(false);
$('download-confirm').onclick = async () => {
  if (!asset || asset.revision !== revision) return;
  const format =
    (document.querySelector<HTMLInputElement>('input[name=\"download-format\"]:checked')
      ?.value as ExportFormat) || 'stl';
  downloadDialog(false);
  updateBusy(true);
  exportRunning = true;
  abort = new AbortController();
  try {
    const result = await exportClient.run(
      format,
      asset,
      project,
      progress => status(progress.message, false, true),
      abort.signal,
    );
    downloadFile(result.bytes as unknown as BlobPart, result.filename, result.mime);
    status(result.filename + ' downloaded.');
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) error(e);
  } finally {
    exportRunning = false;
    updateBusy(false);
  }
};
$('download-calibration').onclick = async () => {
  if (!project || busy) return;
  updateBusy(true);
  try {
    const zip = await engine.call('calibration', { settings: project.settings }, s =>
      status(s.message, false, true),
    );
    downloadFile(zip as unknown as BlobPart, 'Contour Workbench fit test.zip', 'application/zip');
    status(
      'Fit-test bundle downloaded. Print the numbered base and inserts before the full model.',
    );
  } catch (e) {
    error(e);
  } finally {
    updateBusy(false);
  }
};
$('save-project').onclick = () => {
  if (!project) return;
  downloadFile(
    JSON.stringify(project),
    projectFileStem(project.name) + '.contour.json',
    'application/json',
  );
  status('Editable project exported.');
};
$('show-projects').onclick = () => void openLanding();
$('open-project').onclick = () => ($('file-project') as HTMLInputElement).click();
$('landing-open').onclick = () => ($('file-project') as HTMLInputElement).click();
$('file-project').onchange = async () => {
  try {
    const f = await readSelectedFile($<HTMLInputElement>('file-project'));
    if (!f) return;
    const data = JSON.parse(await f.text());
    if (data.schema_version !== 2 || !data.grid || !Array.isArray(data.features))
      throw new Error('This is not a Contour Workbench project.');
    await flushAutosave();
    project = { ...data, settings: normalizeSettings(data.settings) };
    activateNewLocalWorkspace();
    hideLanding();
    $('area-dialog').classList.add('hidden');
    touch();
    projectLabels();
    syncForm();
    listFeatures();
    showProjectLoadingPreview();
    await nextPreviewPaint();
    await rebuild(true, true, false, false, true);
  } catch (e) {
    error(e);
  }
};
$('upload-features').onclick = () => ($('file-features') as HTMLInputElement).click();
$('file-features').onchange = async () => {
  try {
    const f = await readSelectedFile($<HTMLInputElement>('file-features'));
    if (!f) return;
    const data = JSON.parse(await f.text());
    const added = await engine.call('classify', data);
    const prefix = Date.now();
    added.forEach(a => (a.id = `${prefix}:${a.id}`));
    project.features.push(...added);
    touch();
    listFeatures();
    refreshMetrics();
    await updateOverlays();
    status(`Added ${added.length} supported features.`);
  } catch (e) {
    error(e);
  }
};
$('fetch-osm').onclick = async () => {
  if (!project || busy) return;
  updateBusy(true);
  abort = new AbortController();
  try {
    status(
      project.winter_mode
        ? 'Fetching paths, water, glaciers, ski runs, and lifts from OpenStreetMap…'
        : 'Fetching paths, water, and glaciers from OpenStreetMap…',
      false,
      true,
    );
    const query = await engine.call('query', {
      bounds: project.settings.boundary.length
        ? polygonBounds(project.settings.boundary)
        : project.grid.bounds,
      winter: Boolean(project.winter_mode),
    });
    const data = await loadOsm(query, abort.signal);
    const incoming = await engine.call('classify', data);
    const existing = new Map(project.features.map(f => [f.id, f]));
    incoming.forEach(f => {
      if (existing.has(f.id)) {
        f.enabled = existing.get(f.id)!.enabled;
        f.treatment = existing.get(f.id)!.treatment;
      }
      existing.set(f.id, f);
    });
    project.features = [...existing.values()];
    touch();
    listFeatures();
    refreshMetrics();
    await updateOverlays();
    status(
      `Loaded ${incoming.length} OSM features, including polygon zones. Select any feature to configure it.`,
    );
  } catch (e) {
    error(e);
  } finally {
    updateBusy(false);
  }
};
$('base-height').oninput = () => {
  if (!project || !terrain) return;
  const value = Number(($('base-height') as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 0.5 || value > 30) return;
  const delta = value - terrain.layout.base_height;
  if (!delta) return;
  touch();
  project.settings.base_height_mm = value;
  terrain.layout.base_height = value;
  for (let i = 2; i < terrain.mesh.positions.length; i += 3)
    if (terrain.mesh.positions[i] > 0) terrain.mesh.positions[i] += delta;
  for (const o of overlays)
    for (let i = 2; i < o.mesh.positions.length; i += 3)
      if (o.treatment === 'v_carve' || o.mesh.positions[i] > 0) o.mesh.positions[i] += delta;
  viewer.setBaseHeight(delta);
  annotationEditor.refresh();
};
$('height-factor').oninput = () => {
  const v = Number(($('height-factor') as HTMLInputElement).value);
  $('height-value').textContent = v.toFixed(2) + '×';
  if (terrain) viewer.previewHeight(v / terrain.layout.height_factor);
};
$('height-factor').onchange = () => {
  project.settings.height_factor = Number(($('height-factor') as HTMLInputElement).value);
  touch();
  void rebuild();
};
$('manufacturing-mode').onchange = () => {
  project.settings.manufacturing_mode = ($('manufacturing-mode') as HTMLSelectElement)
    .value as Settings['manufacturing_mode'];
  touch();
  syncForm();
  void updateOverlays();
};
$('insert-relative-height').onchange = () => {
  const value = Number(($('insert-relative-height') as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < -10 || value > 10) {
    syncForm();
    return;
  }
  project.settings.insert_relative_height_mm = value;
  touch();
  syncForm();
  void updateOverlays();
};
for (const id of ['terrain-color', 'feature-color', 'terrain-extruder', 'feature-extruder'])
  $(id).onchange = () => {
    project.materials = [
      {
        id: 'terrain',
        name: 'Terrain',
        color: ($('terrain-color') as HTMLInputElement).value,
        extruder: Number(($('terrain-extruder') as HTMLInputElement).value),
      },
      {
        id: 'features',
        name: 'Features',
        color: ($('feature-color') as HTMLInputElement).value,
        extruder: Number(($('feature-extruder') as HTMLInputElement).value),
      },
    ];
    touch();
  };
for (const [id, k] of [['quality', 'terrain_max_error_mm']] as const)
  $(id).onchange = () => {
    project.settings[k] = Number(($(id) as HTMLInputElement).value);
    touch();
    $('quality-caption').textContent =
      project.settings.terrain_max_error_mm === 0
        ? 'Every elevation sample, preserved.'
        : `Sampled height error ≤ ${project.settings.terrain_max_error_mm} mm`;
    void rebuild();
  };
for (const [id, i] of [
  ['bed-width', 0],
  ['bed-depth', 1],
] as const)
  $(id).onchange = () => {
    project.settings.max_print_size_mm[i] = Number(($(id) as HTMLInputElement).value);
    if (project.extent_editor)
      project.settings.boundary = extentPolygon(
        project.extent_editor,
        project.settings.max_print_size_mm,
      );
    touch();
    void rebuild();
  };
$('terrain-island-width').onchange = () => {
  const raw = ($('terrain-island-width') as HTMLInputElement).value.trim();
  project.settings.minimum_terrain_island_width_mm = raw === '' ? null : Number(raw);
  touch();
  fitGuidance();
};
for (const [id, k] of [
  ['nozzle-diameter', 'nozzle_diameter_mm'],
  ['path-width', 'path_width_mm'],
  ['clearance', 'path_clearance_mm'],
  ['edge-clearance', 'feature_edge_clearance_mm'],
  ['fit-clearance', 'insert_fit_clearance_per_side_mm'],
  ['foot-relief', 'insert_elephant_foot_relief_mm'],
  ['foot-height', 'insert_elephant_foot_height_mm'],
  ['draft-angle', 'insert_draft_angle_deg'],
  ['insert-depth', 'insert_depth_mm'],
  ['zone-depth', 'zone_insert_depth_mm'],
  ['zone-floor', 'zone_floor_mm'],
  ['ski-run-width', 'ski_run_width_m'],
  ['carve-depth', 'carve_depth_mm'],
  ['insert-gap', 'insert_gap_mm'],
] as const)
  $(id).onchange = () => {
    project.settings[k] = Number(($(id) as HTMLInputElement).value);
    touch();
    fitGuidance();
    if (id === 'path-width' || id === 'carve-depth' || id === 'edge-clearance') {
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => void updateOverlays(), 100);
    }
  };
$('segment').onchange = () => {
  project.settings.insert_segment_size_mm =
    Number(($('segment') as HTMLSelectElement).value) || null;
  touch();
};
viewer.onNorthAngle = angle => {
  $('north-arrow').style.transform = `rotate(${angle}rad)`;
};
viewer.onTopoStatus = text => {
  $('topo-attribution').textContent = text;
};
$('north-up').onclick = () => viewer.north();
$('topo-map').onclick = () => viewer.setTopo($('topo-map').classList.toggle('active'));
$('fit-view').onclick = () => viewer.fit();
$('top-view').onclick = () => viewer.top();
$('contours').onclick = () => {
  const active = $('contours').classList.toggle('active');
  viewer.setContours(active);
};
$('wireframe').onclick = () => {
  const active = $('wireframe').classList.toggle('active');
  viewer.setWire(active);
};
$('explode').oninput = () => viewer.explode(Number(($('explode') as HTMLInputElement).value));
$('section').oninput = () => viewer.setSection(Number(($('section') as HTMLInputElement).value));
function currentBounds(): Bounds {
  return [
    Number(($('west') as HTMLInputElement).value),
    Number(($('south') as HTMLInputElement).value),
    Number(($('east') as HTMLInputElement).value),
    Number(($('north') as HTMLInputElement).value),
  ];
}
function updateAreaButtons() {
  const covered =
    Boolean(project && extentMap) &&
    extentMap
      .value()
      .every(
        p =>
          p[0] >= project.grid.bounds[0] &&
          p[0] <= project.grid.bounds[2] &&
          p[1] >= project.grid.bounds[1] &&
          p[1] <= project.grid.bounds[3],
      );
  ($('wizard-next') as HTMLButtonElement).disabled = busy || (wizardStep === 1 && !polygonValid);
  ($('area-load') as HTMLButtonElement).disabled = busy || !polygonValid;
  ($('area-reuse') as HTMLButtonElement).disabled = busy || !polygonValid || !covered;
}
function setWizardStep(step: number) {
  wizardStep = Math.max(1, Math.min(3, step));
  document
    .querySelectorAll<HTMLElement>('[data-wizard-page]')
    .forEach(page =>
      page.classList.toggle('hidden', Number(page.dataset.wizardPage) !== wizardStep),
    );
  $('wizard-progress').classList.toggle('hidden', !wizardMode);
  document.querySelectorAll<HTMLElement>('[data-wizard-dot]').forEach(dot => {
    const n = Number(dot.dataset.wizardDot);
    dot.classList.toggle('active', n === wizardStep);
    dot.classList.toggle('complete', n < wizardStep);
  });
  $('wizard-back').classList.toggle('hidden', !wizardMode || wizardStep === 1);
  $('wizard-next').classList.toggle('hidden', !wizardMode || wizardStep === 3);
  $('area-reuse').classList.toggle('hidden', wizardMode);
  $('area-load').classList.toggle('hidden', wizardMode && wizardStep !== 3);
  $('area-eyebrow').textContent = wizardMode ? 'Step one' : 'Choose your landscape';
  $('area-load').innerHTML = wizardMode
    ? 'Create landscape ' + icon('arrow-up-right')
    : 'Load terrain ' + icon('arrow-up-right');
  createIcons({ icons });
  updateAreaButtons();
}
function openArea(asWizard = false) {
  if (busy || (!asWizard && !project)) return;
  if (matchMedia('(max-width: 760px)').matches) mobileSettings(false);
  wizardMode = asWizard;
  const b =
    project && !asWizard
      ? project.settings.boundary.length
        ? polygonBounds(project.settings.boundary)
        : project.grid.bounds
      : newProjectBounds;
  const boundary: Vertex[] =
    project && !asWizard && project.settings.boundary.length
      ? project.settings.boundary
      : [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[2], b[3]],
          [b[0], b[3]],
        ];
  ['west', 'south', 'east', 'north'].forEach(
    (id, i) => (($(id) as HTMLInputElement).value = String(b[i])),
  );
  ($('area-name') as HTMLInputElement).value = asWizard ? 'My landscape' : project.name;
  ($('wizard-source') as HTMLSelectElement).value = 'auto';
  $('area-dialog').dataset.ready = 'false';
  $('area-dialog').classList.remove('hidden');
  setWizardStep(1);
  if (!extentMap)
    extentMap = new ExtentMap($('extent-map'), (points, message, valid) => {
      polygonValid = valid;
      $('polygon-status').textContent = message;
      updateAreaButtons();
    });
  requestAnimationFrame(() => {
    const editor =
      project && !asWizard
        ? project.extent_editor
        : {
            shape: 'rectangle' as Shape,
            points: structuredClone(boundary),
            center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as [number, number],
            width_m: 1000,
            height_m: 750,
            angle_deg: 0,
            corner_radius_m: 0,
          };
    extentMap.open(
      b,
      boundary,
      editor,
      asWizard ? defaults.max_print_size_mm : project.settings.max_print_size_mm,
    );
    const state = extentMap.state();
    ($('extent-shape') as HTMLSelectElement).value = state.shape;
    for (const [id, value] of [
      ['extent-width', state.width_m],
      ['extent-height', state.height_m],
      ['extent-angle', state.angle_deg],
      ['extent-radius', state.corner_radius_m],
    ] as const)
      ($(id) as HTMLInputElement).value = String(value);
    shapeControls(false);
    updateAreaButtons();
    $('area-dialog').dataset.ready = 'true';
  });
}
function shapeControls(apply = true) {
  const shape = ($('extent-shape') as HTMLSelectElement).value as Shape;
  const editable = shape === 'freeform' || shape === 'spline';
  ($('extent-width') as HTMLInputElement).disabled = editable;
  ($('extent-height') as HTMLInputElement).disabled = shape !== 'rectangle';
  ($('extent-angle') as HTMLInputElement).disabled = shape === 'circle';
  ($('extent-radius') as HTMLInputElement).disabled = shape === 'circle' || shape === 'spline';
  $('polygon-draw').textContent = editable ? 'Draw / redraw' : 'Place center';
  ($('polygon-undo') as HTMLButtonElement).disabled = !editable;
  if (apply)
    extentMap.configure(
      shape,
      Number(($('extent-width') as HTMLInputElement).value),
      Number(($('extent-height') as HTMLInputElement).value),
      Number(($('extent-angle') as HTMLInputElement).value),
      Number(($('extent-radius') as HTMLInputElement).value),
    );
}
for (const id of ['extent-shape', 'extent-width', 'extent-height', 'extent-angle', 'extent-radius'])
  $(id).oninput = () => shapeControls();
$('polygon-draw').onclick = () => extentMap.start();
$('polygon-undo').onclick = () => extentMap.undo();
$('polygon-finish').onclick = () => extentMap.finish();
$('map-locate').onclick = () => {
  try {
    const b = currentBounds();
    checkBounds(b);
    extentMap.locate(b);
  } catch (e) {
    $('polygon-status').textContent = (e as Error).message;
  }
};
$('wizard-back').onclick = () => setWizardStep(wizardStep - 1);
$('wizard-next').onclick = () => {
  try {
    if (wizardStep === 1) validatePolygon(extentMap.value());
    setWizardStep(wizardStep + 1);
  } catch (e) {
    error(e);
  }
};
$('area-reuse').onclick = async () => {
  try {
    const points = extentMap.value();
    validatePolygon(points);
    project.settings.boundary = points;
    project.extent_editor = extentMap.state();
    project.name = ($('area-name') as HTMLInputElement).value || project.name;
    $('area-dialog').classList.add('hidden');
    touch();
    projectLabels();
    await rebuild(true);
  } catch (e) {
    error(e);
  }
};
$('change-area').onclick = () => openArea(false);
$('load-area').onclick = () => openArea(false);
$('area-close').onclick = () => {
  $('area-dialog').classList.add('hidden');
  if (wizardMode) void openLanding();
  wizardMode = false;
};
$('area-load').onclick = async () => {
  const creatingProject = wizardMode;
  try {
    if (creatingProject) await flushAutosave();
    const boundary = extentMap.value();
    validatePolygon(boundary);
    const bounds = polygonBounds(boundary);
    selectedBoundary = boundary;
    selectedBounds = bounds;
    $('tile-downloads').innerHTML = '';
    const selectedProduct = (
        wizardMode
          ? ($('wizard-source') as HTMLSelectElement).value
          : ($('source') as HTMLSelectElement).value
      ) as Product,
      product = selectedProduct === 'auto' ? automaticProduct(bounds) : selectedProduct;
    if (product.startsWith('copernicus')) {
      const urls = await engine.call('urls', {
        bounds,
        ninety: product === 'copernicus_glo90',
      });
      $('tile-downloads').innerHTML =
        'If direct loading is blocked by the source, download a tile and import it as a local GeoTIFF:<br/>' +
        urls
          .map(
            (url, i) =>
              `<a href="${esc(url)}" target="_blank" rel="noopener">Download elevation tile ${i + 1}</a>`,
          )
          .join('<br/>');
    }
    const featureChoice = wizardMode
        ? document.querySelector<HTMLInputElement>('input[name="wizard-features"]:checked')
            ?.value || 'osm'
        : 'none',
      prior = wizardMode ? structuredClone(defaults) : normalizeSettings(project?.settings);
    $('area-dialog').classList.add('hidden');
    updateBusy(true);
    abort = new AbortController();
    const loadingLayout = previewLayout(bounds, prior);
    const loadingBoundary = previewBoundary(loadingLayout, boundary);
    viewer.showLoadingMap(loadingLayout, [...loadingBoundary, loadingBoundary[0]]);
    markPreviewStage('topo', true);
    await nextPreviewPaint();
    $('model-caption').textContent = 'SELECTED AREA · LOADING TOPO AND ELEVATION';
    const data = await loadElevation(
      bounds,
      selectedProduct,
      ninety => engine.call('urls', { bounds, ninety }),
      message => status(message, false, true),
      abort.signal,
    );
    project = {
      schema_version: 2,
      winter_mode: featureChoice === 'winter',
      extent_editor: extentMap.state(),
      name: ($('area-name') as HTMLInputElement).value || 'My landscape',
      ...data,
      features: [],
      settings: { ...prior, boundary },
    };
    if (creatingProject) activateNewLocalWorkspace();
    touch();
    projectLabels();
    syncForm();
    listFeatures();
    await rebuild(true, false, true, true, true);
    $('model-caption').textContent = 'TERRAIN READY · LOADING MAP FEATURES';
    let featureWarning = '';
    if (featureChoice !== 'none') {
      try {
        status(
          featureChoice === 'winter'
            ? 'Loading ski runs, lifts, glaciers, and paths…'
            : 'Loading trails, roads, and water…',
          false,
          true,
        );
        const query = await engine.call('query', {
            bounds,
            winter: featureChoice === 'winter',
          }),
          osm = await loadOsm(query, abort.signal);
        project.features = await engine.call('classify', osm);
        if (featureChoice === 'winter')
          for (const f of project.features) {
            if (f.class === 'trail') f.enabled = false;
            if (['glacier', 'ski_run', 'ski_lift'].includes(f.class)) {
              f.enabled = true;
              f.treatment = f.class === 'ski_lift' ? 'v_carve' : 'insert';
            }
          }
      } catch (e) {
        featureWarning =
          'Terrain loaded, but map features could not be added: ' +
          (e instanceof Error ? e.message : String(e));
      }
    }
    if (project.features.length) {
      touch();
      await updateOverlays();
      if (overlays.length) markPreviewStage('features');
    }
    listFeatures();
    $('model-caption').textContent =
      project.settings.terrain_max_error_mm > 0
        ? `DESIGN PREVIEW · ADAPTIVE ≤ ${project.settings.terrain_max_error_mm} MM`
        : 'DESIGN PREVIEW · SOURCE RESOLUTION';
    setPanel(project.features.length ? 'features' : 'terrain');
    status(
      featureWarning ||
        `Landscape ready with ${project.features.length.toLocaleString()} map features.`,
      Boolean(featureWarning),
    );
    wizardMode = false;
  } catch (e) {
    error(e);
    if (wizardMode) $('area-dialog').classList.remove('hidden');
  } finally {
    updateBusy(false);
  }
};
$('upload-dem').onclick = () => ($('file-dem') as HTMLInputElement).click();
$('file-dem').onchange = async () => {
  updateBusy(true);
  try {
    const f = await readSelectedFile($<HTMLInputElement>('file-dem'));
    if (!f) return;
    const data = await loadLocalRaster(
      await f.arrayBuffer(),
      selectedBounds || project.grid.bounds,
    );
    project = {
      ...project,
      ...data,
      settings: {
        ...project.settings,
        boundary: selectedBoundary.length ? selectedBoundary : project.settings.boundary,
      },
    };
    touch();
    projectLabels();
    await rebuild(true);
  } catch (e) {
    error(e);
  } finally {
    updateBusy(false);
  }
};
$('cancel-job').onclick = () => {
  abort.abort();
  if (exportRunning) {
    exportClient.cancel();
    exportRunning = false;
    updateBusy(false);
    status('Export canceled.');
    return;
  }
  engine.cancel();
  updateBusy(false);
  status('Canceled. Restoring the current terrain...');
  if (project) void rebuild();
};
function unproject(p: [number, number]): [number, number] {
  const l = terrain.layout;
  const u = l.rotated ? p[1] / l.depth : p[0] / l.width;
  const v = l.rotated ? 1 - p[0] / l.width : p[1] / l.depth;
  return [
    l.bounds[0] + u * (l.bounds[2] - l.bounds[0]),
    l.bounds[1] + v * (l.bounds[3] - l.bounds[1]),
  ];
}
function stopBoundary() {
  viewer.onBoundary = undefined;
  viewer.boundary([]);
  $('boundary-actions').classList.add('hidden');
  $('draw-boundary').classList.remove('active');
}
$('draw-boundary').onclick = () => openArea(false);
$('boundary-cancel').onclick = stopBoundary;
$('boundary-clear').onclick = () => {
  project.settings.boundary = [];
  stopBoundary();
  touch();
  void rebuild();
};
$('boundary-apply').onclick = () => {
  if (boundaryPoints.length < 3) {
    status('Place at least three boundary vertices.', true);
    return;
  }
  project.settings.boundary = boundaryPoints.map(unproject);
  stopBoundary();
  touch();
  void rebuild();
};
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    stopBoundary();
    if (!$('area-dialog').classList.contains('hidden')) $('area-close').click();
  }
});
async function projectThumbnailDataUrl() {
  const thumbnail = await viewer.createThumbnail();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Thumbnail encoding failed.'));
    reader.readAsDataURL(thumbnail);
  });
}

async function buildPresetDownload() {
  if (!project || !terrain) throw new Error('Open a project before building a preset.');
  await engine.call('hydrate', { project, terrain });
  const packed = await engine.call('preset-pack', { project }, s => status(s.message, false, true)),
    name =
      project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'landscape';
  downloadFile(packed as unknown as BlobPart, name + '.cwpack', 'application/zip');
  status('Static preset bundle downloaded.');
}
// Read-only diagnostics for integration tests and performance verification.
Object.defineProperty(window, 'contourDiagnostics', {
  get: () => ({
    terrainBuilds,
    annotations: project?.annotations,
    features: project?.features.length,
    enabled: project?.features.filter(f => f.enabled).length,
    revision,
    busy,
    overlayBusy: overlayRunning || overlayAgain,
    previewStage,
    previewStageHistory: [...previewStageHistory],
    mode,
    boundary: project?.settings.boundary,
    triangles: terrain?.mesh.indices.length / 3,
    baseHeight: project?.settings.base_height_mm,
    treatments: project?.features.reduce(
      (counts, f) => {
        const t = f.enabled ? treatment(f) : 'hide';
        counts[t] = (counts[t] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    ),
    asset: asset?.validation,
    insertTapers: asset?.inserts.map(i => ({
      id: i.id,
      relief: i.taper_relief_mm,
      height: i.taper_height_mm,
      draft: i.draft_angle_deg,
    })),
    landingOpen: !$('landing-dialog').classList.contains('hidden'),
    wizardStep: wizardMode ? wizardStep : 0,
    buildPreset: import.meta.env.DEV ? buildPresetDownload : undefined,
    thumbnail: import.meta.env.DEV ? projectThumbnailDataUrl : undefined,
  }),
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushAutosave();
});

async function start() {
  updateBusy(false);
  status('');
  showLanding();
  try {
    const catalog = await loadPresetCatalog();
    presetEntries = catalog.models;
    await renderLanding();
    const requested = new URLSearchParams(location.search).get('preset');
    if (requested) {
      const entry = presetEntries.find(item => item.id === requested);
      if (entry) {
        await openPresetModel(entry);
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('preset');
        history.replaceState(null, '', cleanUrl);
      }
    }
  } catch (e) {
    error(e);
    presetEntries = [];
    await renderLanding();
  }
}
void start();

$('extent-map').addEventListener('extent-edit', event => {
  const state = (event as CustomEvent).detail;
  for (const [id, value] of [
    ['extent-width', state.width_m],
    ['extent-height', state.height_m],
    ['extent-angle', state.angle_deg],
  ] as const)
    ($(id) as HTMLInputElement).value = String(Math.round(value * 100) / 100);
});

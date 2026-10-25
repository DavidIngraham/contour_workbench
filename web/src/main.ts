import {
  couponFields,
  couponLabels,
  couponLayout,
  defaultCouponOptions,
  validateCoupon,
} from './fit-coupon';
import { PrintOrderDialog } from './print-order-dialog';
/** Browser application composition, UI state, persistence, and worker orchestration. */
import { AnnotationEditor } from './annotation-editor';
import { renderAppShell } from './app-shell';
import { FeatureBrowser } from './feature-browser';
import { setupWorkbenchChrome } from './workbench-chrome';
import { setupPwa } from './pwa';
import { parseGpx } from './gpx';
import { FeatureSourcePanel } from './feature-source-panel';
import {
  defaultFeatureSources,
  downloadFeatureSource,
  identifySourceFeatures,
  mergeSourceFeatures,
  groupFeaturesBySource,
  type FeatureSource,
} from './feature-sources';
import { filamentPlan } from './filaments';
import { gpxPlacement } from './gpx-placement';
import { downloadFile, projectFileStem, readSelectedFile } from './project-files';
import './style.css';
import './workbench.css';
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
import { resolveStatusProgress } from './status-progress';
import { userErrorMessage } from './user-errors';
import { extentPolygon, type Shape } from './extent-shapes';
import { ExtentMap } from './extent-map';
import { polygonBounds, validatePolygon, type Vertex } from './polygon';
import { previewBoundary, previewLayout } from './preview-layout';
import { Viewer } from './viewer';
import { Engine } from './client';
import { ExportClient } from './export-client';
import { browserBuildMemoryBudgetMb } from './memory-plan';
import type { BambuPrinterId } from './bambu-printers';
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
  defaultMaterialGroups,
  defaults,
  defaultClassPriority,
  normalizeClassPriority,
  normalizeSettings,
  projectMaterialGroups,
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
setupPwa();
const legacyFeatureMaterialRow = $('feature-color').closest<HTMLElement>('.input-row');
if (legacyFeatureMaterialRow)
  legacyFeatureMaterialRow.outerHTML =
    '<div class="material-list"><div class="material-list-heading"><span>Feature class</span><span>Color</span><span>Slot</span></div>' +
    defaultMaterialGroups
      .slice(1)
      .map(
        group =>
          `<div class="material-row"><label for="material-${group.id}-color">${esc(group.name)}</label><input id="material-${group.id}-color" type="color" value="${group.color}" aria-label="${esc(group.name)} color"/><input id="material-${group.id}-extruder" type="number" min="1" max="16" value="${group.extruder}" aria-label="${esc(group.name)} filament slot"/></div>`,
      )
      .join('') +
    '</div><div id="filament-mapping"><p class="help">One slot represents one physical filament. Multicolor previews use the slot colors shown here.</p><div id="filament-slots"></div><p class="help" id="filament-warning" role="status"></p><button class="small-link" id="normalize-filaments">Use slot colors for all assigned features</button></div>';
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
const printOrder = new PrintOrderDialog(() => (asset && !busy ? { asset, project } : undefined));
$('order-print').onclick = () => {
  downloadDialog(false);
  void printOrder.open();
};
let revision = 0;
let busy = false;
let exportRunning = false;
let mode: 'design' | 'review' = 'design';
let selected: string | null = null;
let commandProject: Project | undefined;
let modelNeedsRegeneration = false;
let abort = new AbortController();
let osmAbort: AbortController | undefined;
let osmLoadSerial = 0;
let osmLoading = false;
let osmRetryAvailable = false;
let sourcePanel: FeatureSourcePanel | undefined;
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
const featureBrowser = new FeatureBrowser({
  include: setVisibility,
  treatment: setTreatment,
  changed: () => {
    touch();
    refreshMetrics();
    void updateOverlays();
  },
  select: id => {
    selected = id;
    viewer.highlight(id);
  },
  zoom: feature => {
    viewer.highlight(feature.id);
    viewer.focusFeature(feature);
    mobileSettings(false);
    status(
      'Showing the complete feature footprint. Only sections inside the model area are printed.',
    );
  },
});
function syncModelCommands() {
  if (commandProject !== project) {
    commandProject = project;
    modelNeedsRegeneration = false;
  }
  const current = Boolean(asset && asset.revision === revision);
  const reason = busy
    ? 'Processing model…'
    : current
      ? ''
      : modelNeedsRegeneration
        ? 'Model changed—generate again before inspection or export.'
        : 'Generate the model to enable inspection and export.';
  for (const id of ['download', 'mode-review']) {
    const button = $<HTMLButtonElement>(id);
    button.disabled = busy || !current;
    button.title = reason;
  }
  $('inspection-reason').textContent = reason;
  $('export-reason').textContent = reason;
  $('export-reason').classList.toggle('hidden', !reason);
  $<HTMLButtonElement>('order-print').disabled = busy || !current;
  $('order-print').title = reason;
  $<HTMLButtonElement>('save-project').disabled = !project;
  $<HTMLButtonElement>('open-project').disabled = busy;
  $<HTMLButtonElement>('new-project').disabled = busy;
  $<HTMLButtonElement>('show-projects').disabled = busy;
  $<HTMLButtonElement>('change-area').disabled = busy || !project;
}
function status(
  message: string,
  error = false,
  loading = false,
  completed?: number,
  total?: number,
) {
  const container = $('status');
  if ($<HTMLDialogElement>('sources-dialog').open) $('source-progress').textContent = message;
  container.classList.toggle('error', error);
  if (!message) {
    container.classList.remove('with-progress');
    container.innerHTML = '';
    return;
  }
  const progress = loading ? resolveStatusProgress(message, completed, total) : undefined;
  container.classList.toggle('with-progress', Boolean(progress));
  const bar = progress
    ? `<div class="status-progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.completed}"><span style="width:${progress.percent}%"></span></div>`
    : '';
  container.innerHTML =
    '<div class="status-body"><div class="status-line">' +
    (loading ? '<span class="spinner"></span>' : '') +
    `<span>${esc(message)}</span></div>${bar}</div>`;
}
function progressStatus(progress: { message: string; completed?: number; total?: number }) {
  status(progress.message, false, true, progress.completed, progress.total);
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
  $('model-caption').textContent = 'Loading basemap and elevation';
}
function syncOsmAction() {
  const button = $('fetch-osm') as HTMLButtonElement;
  const isOsm = !sourcePanel || sourcePanel.selected().kind === 'overpass';
  button.disabled = busy || osmLoading || !project || sourcePanel?.selectedClasses().length === 0;
  button.textContent = osmLoading
    ? isOsm
      ? 'Loading trails and water…'
      : 'Loading source…'
    : osmRetryAvailable
      ? isOsm
        ? 'Retry trails and water'
        : 'Retry source'
      : isOsm
        ? 'Load OpenStreetMap features'
        : 'Load source';
  sourcePanel?.setDisabled(busy || osmLoading);
  document.querySelectorAll<HTMLButtonElement>('[data-remove-loaded-source]').forEach(button => {
    button.disabled = busy || osmLoading;
  });
  $('cancel-feature-source').classList.toggle('hidden', !osmLoading);
}
function cancelOsmLoad(resetAction = true) {
  osmLoadSerial++;
  osmAbort?.abort();
  osmAbort = undefined;
  osmLoading = false;
  if (resetAction) osmRetryAvailable = false;
  syncOsmAction();
}
function updateBusy(v: boolean) {
  busy = v;
  ($('generate') as HTMLButtonElement).disabled = v || !terrain;
  ($('load-area') as HTMLButtonElement).disabled = v;
  ($('download-calibration') as HTMLButtonElement).disabled = v;
  $<HTMLButtonElement>('landing-calibration').disabled = v;
  $<HTMLButtonElement>('download-color-calibration').disabled = v;
  ($('area-load') as HTMLButtonElement).disabled = v || !polygonValid;
  $('cancel-job').classList.toggle('hidden', !v);
  syncModelCommands();
  syncOsmAction();
}
function error(e: unknown) {
  console.error(e);
  status(userErrorMessage(e), true);
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
  if (asset) modelNeedsRegeneration = true;
  printOrder.invalidate();
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
  syncModelCommands();
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
  document.querySelectorAll('[data-tab]').forEach(e => {
    const active = (e as HTMLElement).dataset.tab === name;
    e.classList.toggle('active', active);
    e.setAttribute('aria-pressed', String(active));
  });
  ['terrain', 'features', 'annotations', 'print', 'inspect'].forEach(n =>
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
    `<button class="preset-card preset-new" id="preset-new" aria-label="Create a new project"><span class="new-model-icon">${icon('plus')}</span><span class="preset-copy"><strong>New project</strong><span>Select an area, elevation source, and map features.</span></span></button>`;
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
  $('preset-new').onclick = () => $('new-project').click();
}
async function openLanding() {
  cancelOsmLoad();
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
  cancelOsmLoad();
  await flushAutosave();
  updateBusy(true);
  status('Opening local project…', false, true);
  try {
    const loaded = await loadLocalProject(id);
    if (!loaded) throw new Error('This local project is no longer available.');
    project = { ...loaded.project, settings: normalizeSettings(loaded.project.settings) };
    activateStoredWorkspace(loaded.summary);
    printOrder.invalidate();
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
  cancelOsmLoad();
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
    printOrder.invalidate();
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
    viewer.setTerrain(terrain.mesh, terrain.layout, true, project);
    markPreviewStage('terrain');
    status('Terrain ready. Adding map features...', false, true);
    $('model-caption').textContent = 'Terrain ready · loading features';
    await nextPreviewPaint();
    viewer.setOverlays(overlays, project.features, project.settings, project);
    if (overlays.length) markPreviewStage('features');
    annotationEditor.refresh();
    refreshMetrics();
    $('model-caption').textContent = 'Editing example';
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

document.querySelectorAll('[data-tab]').forEach(e =>
  e.addEventListener('click', () => {
    const name = (e as HTMLElement).dataset.tab!;
    if (name === 'inspect' && asset && asset.revision === revision && !busy)
      $('mode-review').click();
    else setPanel(name);
  }),
);
const classLabels: Record<Feature['class'], string> = {
  trail: 'Trails',
  road: 'Roads',
  stream: 'Waterways',
  water: 'Lakes & rivers',
  glacier: 'Glaciers',
  ski_run: 'Ski runs',
  ski_lift: 'Ski lifts',
};
const treatment = (f: Feature): Treatment => (f.treatment === 'v_carve' ? 'v_carve' : 'insert');
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
function filamentSummary() {
  const { slots } = filamentPlan(project);
  return [...slots]
    .map(
      ([number, slot]) =>
        `<div class="filament-slot"><span class="filament-swatch" style="background:${slot.color}"></span><span>Slot ${number} · ${esc(slot.color)}<small>${slot.names.map(esc).join(', ')}</small></span></div>`,
    )
    .join('');
}
function syncFilaments() {
  const together = project.settings.manufacturing_mode === 'multicolor';
  $('filament-mapping').classList.toggle('hidden', !together);
  if (!together) return;
  const conflicts = [...filamentPlan(project).slots].filter(([, slot]) => slot.conflict);
  $('filament-slots').innerHTML = filamentSummary();
  $('filament-warning').textContent = conflicts.length
    ? `Different colors share ${conflicts.map(([number]) => `slot ${number}`).join(', ')}. Preview and export use the slot colors above. Choose different slots for different printed colors, or use the shared colors.`
    : 'Preview and export use these same filament colors.';
  $('normalize-filaments').classList.toggle('hidden', !conflicts.length);
}
function listFeatures() {
  if (!project) return;
  const priority = normalizeClassPriority(project.settings.class_priority);
  $('class-priority-list').innerHTML = priority
    .map(
      (cls, index) =>
        `<div class="class-priority-row"><span>${index + 1}. ${classLabels[cls]}</span><button data-priority-class="${cls}" data-direction="-1" aria-label="Move ${classLabels[cls]} up" ${index === 0 ? 'disabled' : ''}>↑</button><button data-priority-class="${cls}" data-direction="1" aria-label="Move ${classLabels[cls]} down" ${index === priority.length - 1 ? 'disabled' : ''}>↓</button></div>`,
    )
    .join('');
  $('class-priority-list')
    .querySelectorAll<HTMLButtonElement>('[data-priority-class]')
    .forEach(button => {
      button.onclick = () => {
        const cls = button.dataset.priorityClass as Feature['class'];
        const from = priority.indexOf(cls),
          to = from + Number(button.dataset.direction);
        if (to < 0 || to >= priority.length) return;
        [priority[from], priority[to]] = [priority[to], priority[from]];
        project.settings.class_priority = priority;
        touch();
        listFeatures();
        const focus =
          $('class-priority-list').querySelector<HTMLButtonElement>(
            `[data-priority-class="${cls}"][data-direction="${button.dataset.direction}"]:not(:disabled)`,
          ) ??
          $('class-priority-list').querySelector<HTMLButtonElement>(
            `[data-priority-class="${cls}"]:not(:disabled)`,
          );
        focus?.focus();
        void updateOverlays();
      };
    });
  $('reset-class-priority').onclick = () => {
    project.settings.class_priority = [...defaultClassPriority];
    touch();
    listFeatures();
    void updateOverlays();
  };
  const sources = groupFeaturesBySource(project.features);
  $('loaded-sources').innerHTML = sources.length
    ? `<h3>Loaded sources</h3><p class="help">Remove a source’s features from all classes in this model.</p>${sources.map(source => `<div class="loaded-source"><span>${esc(source.name)}<small>${source.features.length} features</small></span><button class="small-link" data-remove-loaded-source="${esc(source.id)}" aria-label="Remove ${esc(source.name)} from model" ${busy || osmLoading ? 'disabled' : ''}>Remove</button></div>`).join('')}`
    : '';
  $('loaded-sources')
    .querySelectorAll<HTMLButtonElement>('[data-remove-loaded-source]')
    .forEach(button => {
      button.onclick = () => {
        if (busy || osmLoading) return;
        const source = sources.find(source => source.id === button.dataset.removeLoadedSource)!;
        if (
          !confirm(
            `Remove all ${source.features.length} features from “${source.name}” across all classes in this model? This only changes the current model.`,
          )
        )
          return;
        const removed = new Set(source.features.map(f => f.id));
        project.features = project.features.filter(f => !removed.has(f.id));
        for (const id of removed) {
          winterRestore.delete(id);
          viewer.toggle(id, false);
        }
        if (selected && removed.has(selected)) {
          selected = null;
          viewer.highlight(null);
        }
        touch();
        listFeatures();
        refreshMetrics();
        void updateOverlays();
      };
    });
  featureBrowser.render(project);
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
    void loadProjectOsm();
};
viewer.onPick = id => {
  selected = id;
  viewer.highlight(id);
  featureBrowser.selectFeature(id);
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
    s.manufacturing_mode === 'multicolor'
      ? 'Terrain islands are preserved so color parts meet without unfilled gaps.'
      : s.minimum_terrain_island_width_mm === null
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
    ['draft-height', 'insert_draft_height_mm'],
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

  const groups = projectMaterialGroups(project);
  const terrainGroup = groups[0];
  ($('terrain-color') as HTMLInputElement).value = terrainGroup.color;
  ($('terrain-extruder') as HTMLInputElement).value = String(terrainGroup.extruder);
  for (const group of groups.slice(1)) {
    ($(`material-${group.id}-color`) as HTMLInputElement).value = group.color;
    ($(`material-${group.id}-extruder`) as HTMLInputElement).value = String(group.extruder);
  }
  $('quality-caption').textContent =
    s.terrain_max_error_mm === 0
      ? 'Uses all source elevation samples'
      : `Sampled height error ≤ ${s.terrain_max_error_mm} mm`;
  const together = s.manufacturing_mode === 'multicolor';
  for (const id of [
    'fit-clearance',
    'foot-relief',
    'foot-height',
    'draft-angle',
    'draft-height',
    'insert-gap',
    'segment',
    'terrain-island-width',
    'insert-depth',
    'zone-depth',
  ])
    $<HTMLInputElement | HTMLSelectElement>(id).disabled = together;
  $('fit-calibration').classList.toggle('hidden', together);
  $('color-calibration').classList.toggle('hidden', !together);
  document
    .querySelectorAll<HTMLElement>('[data-fit-only]')
    .forEach(element => element.classList.toggle('hidden', together));
  $('feature-settings-title').textContent = 'Feature geometry';
  syncFilaments();
  $('manufacturing-guidance').textContent = together
    ? 'Print one model with multiple filaments. The slicer controls color depth, walls, and infill.'
    : 'Print the terrain and inserts separately, then assemble. Clearance, tapered lower edges, and optional segmentation help the pieces fit.';
  $('fit-mode-guidance').textContent = together
    ? 'Relative height controls raised or recessed details. Color depth is determined by the slicer, so insert depth and assembly settings do not apply.'
    : 'Full-model inserts avoid unnecessary breaks. Model-edge clearance preserves a terrain border around pockets. The visible top stays full-size while buried lower layers taper inward.';
  fitGuidance();
}
function projectLabels() {
  annotationEditor.sync();
  $('location-name').textContent = project.name;
  $('project-title').textContent = project.name;
  $('project-subtitle').textContent = project.source.name;
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
      progressStatus,
    );
    if (requested !== revision) {
      status('Settings changed during generation. Applying the latest design…', false, true);
      updateBusy(false);
      return rebuild(fit);
    }
    terrain = t;
    terrainBuilds = t.terrainBuilds;
    viewer.model.scale.z = 1;
    viewer.setTerrain(t.mesh, t.layout, fit, project);
    if (stagedPreview) {
      markPreviewStage('terrain');
      $('model-caption').textContent = 'Terrain ready · loading features';
      await nextPreviewPaint();
    }
    overlays = includeOverlays
      ? await engine.call(
          'overlays',
          { features: project.features, settings: project.settings },
          progressStatus,
        )
      : [];
    viewer.setOverlays(overlays, project.features, project.settings, project);
    if (stagedPreview && overlays.length) markPreviewStage('features');
    annotationEditor.refresh();
    $('model-caption').textContent =
      project.settings.terrain_max_error_mm > 0
        ? 'Editing model · adaptive detail'
        : 'Editing model · full source resolution';
    refreshMetrics();
    listFeatures();
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
      if (!previewSuspended)
        viewer.setOverlays(overlays, project.features, project.settings, project);
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
    viewer.setTerrain(terrain.mesh, terrain.layout, false, project);
    viewer.setOverlays(overlays, project.features, project.settings, project);
    annotationEditor.refresh();
    viewer.setSection(100);
  }
  $('model-caption').textContent = 'Editing model';
  $('review-controls').classList.add('hidden');
}
$('mode-design').onclick = design;
$('mode-review').onclick = () => {
  if (!asset || asset.revision !== revision) return;
  mode = 'review';
  viewer.showAsset(asset, terrain.layout, project);
  annotationEditor.refresh(true);
  $('mode-review').classList.add('active');
  $('mode-design').classList.remove('active');
  $('model-caption').textContent = 'Generated model';
  $('review-controls').classList.remove('hidden');
  $<HTMLInputElement>('explode').disabled = Boolean(asset.faceMaterials);
  setPanel('inspect');
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
      progressStatus,
    );
    if (requested !== revision) {
      status('The design changed while generating. Generate again for the latest selection.');
      return;
    }
    asset = result;
    ($('download') as HTMLButtonElement).disabled = false;
    ($('mode-review') as HTMLButtonElement).disabled = false;
    $('asset-summary').innerHTML =
      `<div class="review-box"><strong class="check">✓ Validated solid geometry</strong><br/>${result.validation.triangles.toLocaleString()} terrain triangles<br/>${result.faceMaterials ? 'One multicolor solid · color depth controlled by slicer' : result.inserts.length + ' independently printable inserts'}<br/>${insertSurfaceDescription(project.settings)}${result.validation.removed_terrain_islands ? `<br/>${result.validation.removed_terrain_islands} unprintable terrain ${result.validation.removed_terrain_islands === 1 ? 'pin' : 'pins'} removed` : ''}</div>`;
    $('piece-list').innerHTML = result.inserts
      .map(p => `<div class="review-piece"><span>${esc(p.id)}</span></div>`)
      .join('');
    $('mode-review').click();
    completed = true;
    status(
      result.validation.removed_terrain_islands
        ? `Your model is ready. Removed ${result.validation.removed_terrain_islands} unprintable terrain ${result.validation.removed_terrain_islands === 1 ? 'pin' : 'pins'} while preserving the insert gaps.`
        : 'Model generated. Inspect the parts or export the model.',
    );
  } catch (e) {
    error(e);
  } finally {
    previewSuspended = false;
    if (releasePreview && !completed && mode === 'design') {
      viewer.setTerrain(terrain.mesh, terrain.layout, false, project);
      viewer.setOverlays(overlays, project.features, project.settings, project);
    }
    updateBusy(false);
  }
};
function syncExportOptions() {
  const together = project.settings.manufacturing_mode === 'multicolor';
  const threeMf =
    document.querySelector<HTMLInputElement>('input[name="download-format"]:checked')?.value ===
    '3mf';
  const slicer = $<HTMLSelectElement>('export-slicer').value;
  $('three-mf-options').classList.toggle('hidden', !threeMf);
  $('export-bambu-options').classList.toggle('hidden', !threeMf || slicer !== 'bambu');
  $('export-filaments').innerHTML = together && threeMf ? filamentSummary() : '';
  $('export-mode-note').textContent = together
    ? 'Print together: one watertight solid with painted surface regions.'
    : 'Separate inserts: fitted parts to print individually and assemble.';
  $('export-format-note').textContent = !threeMf
    ? together
      ? 'STL exports the shape only and loses painted colors. Choose Bambu Studio or PrusaSlicer 3MF to preserve filament assignments.'
      : 'Print each STL separately. The included manifest records where every insert belongs.'
    : together
      ? 'Bambu Studio and PrusaSlicer 3MF preserve painted filament assignments. Standard 3MF stores face colors; support varies by slicer.'
      : slicer === 'bambu'
        ? 'Single-filament plates print by layer with compact spacing. Mixed-filament plates print by object with printer clearance. Check the slice with your selected printer and filament.'
        : 'Parts are separated and placed flat. Arrange them on your build plates before slicing.';
}
document.querySelectorAll<HTMLInputElement>('input[name="download-format"]').forEach(input => {
  input.onchange = syncExportOptions;
});
$('export-slicer').onchange = syncExportOptions;
function downloadDialog(open: boolean) {
  $('download-dialog').classList.toggle('hidden', !open);
  document.querySelector<HTMLElement>('.workspace')!.inert = open;
  document.querySelector<HTMLElement>('header')!.inert = open;
  if (open) {
    syncExportOptions();
    ($('download-confirm') as HTMLButtonElement).focus();
  }
}
$('download').onclick = () => {
  if (asset && asset.revision === revision) downloadDialog(true);
};
$('download-cancel').onclick = () => downloadDialog(false);
$('download-confirm').onclick = async () => {
  if (!asset || asset.revision !== revision) return;
  const format: ExportFormat =
    document.querySelector<HTMLInputElement>('input[name="download-format"]:checked')?.value ===
    '3mf'
      ? ($<HTMLSelectElement>('export-slicer').value as ExportFormat)
      : 'stl';
  downloadDialog(false);
  updateBusy(true);
  exportRunning = true;
  abort = new AbortController();
  try {
    const result = await exportClient.run(format, asset, project, progressStatus, abort.signal, {
      bambuPrinter: $<HTMLSelectElement>('export-bambu-printer').value as BambuPrinterId,
    });
    downloadFile(result.bytes as unknown as BlobPart, result.filename, result.mime);
    status(result.filename + ' downloaded.');
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) error(e);
  } finally {
    exportRunning = false;
    updateBusy(false);
  }
};
$('download-color-calibration').onclick = async () => {
  if (!project || busy) return;
  updateBusy(true);
  try {
    const bytes = await engine.call(
      'color-calibration',
      { nozzle: project.settings.nozzle_diameter_mm },
      progressStatus,
    );
    downloadFile(
      bytes as unknown as BlobPart,
      'Contour Workbench multicolor test.3mf',
      'model/3mf',
    );
    status(
      'Multicolor test downloaded. Assign three filaments in Bambu Studio, check the slice, then print to inspect coverage.',
    );
  } catch (e) {
    error(e);
  } finally {
    updateBusy(false);
  }
};
let fitDownloadFromLanding = false;
let couponSettings: Settings;
function readCouponForm() {
  const settings = { ...couponSettings };
  for (const [key] of couponFields)
    settings[key] = $<HTMLInputElement>(`coupon-${key}`).valueAsNumber;
  const coupon = {
    floor_thickness_mm: $<HTMLInputElement>('coupon-floor-thickness').valueAsNumber,
    clearances_mm: [1, 2, 3, 4].map(
      n => $<HTMLInputElement>(`coupon-clearance-${n}`).valueAsNumber,
    ),
  };
  validateCoupon(settings, coupon);
  return { settings, coupon };
}
function updateCouponPreview() {
  try {
    const { settings, coupon } = readCouponForm();
    const labels = couponLabels(settings, coupon);
    const layout = couponLayout(settings, coupon);
    $('coupon-label-preview').textContent = [...labels.settings, labels.pockets.join('   ')].join(
      '\n',
    );
    $('coupon-size').textContent =
      `Base: ${layout.widthMm.toFixed(1)} × ${layout.depthMm.toFixed(1)} mm; total height ${layout.totalHeightMm.toFixed(2)} mm, including ${layout.reliefMm.toFixed(2)} mm of repeated terrain relief. Insert tops follow the terrain; MIN INSERT records their minimum thickness. Labels are recessed ${layout.engravingDepthMm.toFixed(1)} mm into the underside, leaving at least ${(layout.floorMm - layout.engravingDepthMm).toFixed(2)} mm beneath the pockets. Taper settings are available under Advanced and are recorded in export metadata. Larger nozzles and wider paths increase the coupon size. Match the nozzle and filament in your slicer; layer height is selected there.`;
    $('coupon-error').textContent = '';
    $<HTMLButtonElement>('fit-download-confirm').disabled = false;
  } catch (e) {
    $('coupon-error').textContent = userErrorMessage(e);
    $('coupon-label-preview').textContent = 'Adjust the settings to preview your coupon.';
    $('coupon-size').textContent = '';
    $<HTMLButtonElement>('fit-download-confirm').disabled = true;
  }
}
$('fit-download-dialog').addEventListener('input', updateCouponPreview);
$('fit-download-format').onchange = () => {
  $('fit-bambu-options').classList.toggle(
    'hidden',
    $<HTMLSelectElement>('fit-download-format').value !== 'bambu',
  );
};
function fitDownloadDialog(open: boolean) {
  $('fit-download-dialog').classList.toggle('hidden', !open);
  $('landing-dialog').inert = open;
  const blocked = open || !$('landing-dialog').classList.contains('hidden');
  document.querySelector<HTMLElement>('.workspace')!.inert = blocked;
  document.querySelector<HTMLElement>('header')!.inert = blocked;
  if (open) {
    $('fit-download-settings').textContent = fitDownloadFromLanding
      ? 'Start from defaults and adjust this test for your printer.'
      : 'Starts from your current Print setup. Changes here affect only this test.';
    $('fit-download-title').tabIndex = -1;
    $('fit-download-title').focus({ preventScroll: true });
    $('fit-download-dialog').querySelector('.modal')!.scrollTop = 0;
  } else {
    $(fitDownloadFromLanding ? 'landing-calibration' : 'download-calibration').focus();
  }
}
function openFitDownload(fromLanding: boolean) {
  if (busy) return;
  fitDownloadFromLanding = fromLanding;
  couponSettings = { ...(fromLanding ? defaults : project.settings) };
  $<HTMLInputElement>('coupon-floor-thickness').value = '1';
  for (const [key] of couponFields)
    $<HTMLInputElement>(`coupon-${key}`).value = String(couponSettings[key]);
  defaultCouponOptions(couponSettings).clearances_mm.forEach((value, i) => {
    $<HTMLInputElement>(`coupon-clearance-${i + 1}`).value = value.toFixed(2);
  });
  updateCouponPreview();
  fitDownloadDialog(true);
}
$('landing-calibration').onclick = () => openFitDownload(true);
$('download-calibration').onclick = () => openFitDownload(false);
$('fit-download-cancel').onclick = () => fitDownloadDialog(false);
$('fit-download-dialog').onkeydown = event => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    fitDownloadDialog(false);
  }
};
$('fit-download-confirm').onclick = async () => {
  if (busy) return;
  const format = $<HTMLSelectElement>('fit-download-format').value as
    'stl' | 'portable' | 'bambu' | 'prusa';
  let config: ReturnType<typeof readCouponForm>;
  try {
    config = readCouponForm();
  } catch {
    updateCouponPreview();
    return;
  }
  const fitStatus = (message: string) => {
    if (fitDownloadFromLanding) $('landing-fit-status').textContent = message;
  };
  fitDownloadDialog(false);
  updateBusy(true);
  fitStatus('Generating fit test…');
  try {
    const bytes = await engine.call(
      'calibration',
      {
        ...config,
        format,
        bambuPrinter: $<HTMLSelectElement>('fit-bambu-printer').value as BambuPrinterId,
      },
      progressStatus,
    );
    downloadFile(
      bytes as unknown as BlobPart,
      `Contour Workbench fit test.${format === 'stl' ? 'zip' : '3mf'}`,
      format === 'stl' ? 'application/zip' : 'model/3mf',
    );
    const message =
      'Fit test downloaded. Print the labeled base and inserts, then use the best-fitting pocket’s engraved clearance in Print setup.';
    status(message);
    fitStatus(message);
  } catch (e) {
    error(e);
    fitStatus(userErrorMessage(e));
    fitDownloadDialog(true);
    $('coupon-error').textContent = userErrorMessage(e);
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
  cancelOsmLoad();
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
$('upload-gpx').onclick = () => {
  $<HTMLDialogElement>('sources-dialog').close();
  $<HTMLInputElement>('file-gpx').click();
};
$('file-gpx').onchange = async () => {
  const input = $<HTMLInputElement>('file-gpx');
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length || !project) return;
  const target = project;
  const button = $<HTMLButtonElement>('upload-gpx');
  button.disabled = true;
  try {
    if (files.reduce((size, file) => size + file.size, 0) > 100_000_000)
      throw new Error('Please select GPX files totaling less than 100 MB.');
    const added: Feature[] = [];
    for (const file of files) added.push(...parseGpx(await file.text(), file.name));
    // A project switch during file reading must not import into the new workspace.
    if (project !== target) return;
    project.features.push(...added);
    touch();
    $<HTMLInputElement>('feature-search').value = '';
    listFeatures();
    refreshMetrics();
    setPanel('features');
    await updateOverlays();
    if (project === target)
      status(
        `Added ${added.length} GPX ${added.length === 1 ? 'feature' : 'features'}. ${added.filter(f => gpxPlacement(f, project.grid.bounds, project.settings.boundary) === 'outside').length} outside terrain; ${added.filter(f => gpxPlacement(f, project.grid.bounds, project.settings.boundary) === 'partial').length} partly outside.`,
      );
  } catch (e) {
    if (project === target) error(e);
  } finally {
    button.disabled = false;
  }
};
$('upload-features').onclick = () => {
  $<HTMLDialogElement>('sources-dialog').close();
  $<HTMLInputElement>('file-features').click();
};
$('file-features').onchange = async () => {
  try {
    const f = await readSelectedFile($<HTMLInputElement>('file-features'));
    if (!f) return;
    const data = JSON.parse(await f.text());
    const added = await engine.call('classify', data);
    const prefix = Date.now();
    added.forEach(a => {
      a.id = `${prefix}:${a.id}`;
      a.tags = { ...a.tags, contour_source: { id: `upload:${prefix}`, name: f.name } };
    });
    project.features.push(...added);
    touch();
    listFeatures();
    refreshMetrics();
    await updateOverlays();
    status(`Added ${added.length} supported ${added.length === 1 ? 'feature' : 'features'}.`);
  } catch (e) {
    error(e);
  }
};
async function loadProjectOsm(focusFeatures = false) {
  return loadProjectFeatures(focusFeatures, defaultFeatureSources[0]);
}
async function loadProjectFeatures(
  focusFeatures = false,
  source: FeatureSource = sourcePanel!.selected(),
) {
  if (!project || busy || osmLoading) return;
  sourcePanel?.choose(source.id);
  const classes = sourcePanel!.selectedClasses();
  if (!classes.length) {
    status('Choose at least one class to load.');
    return;
  }
  const target = project;
  const serial = ++osmLoadSerial;
  const controller = new AbortController();
  osmAbort = controller;
  osmLoading = true;
  osmRetryAvailable = false;
  syncOsmAction();
  try {
    const bounds = target.settings.boundary.length
      ? polygonBounds(target.settings.boundary)
      : target.grid.bounds;
    let incoming: Feature[];
    if (source.kind === 'overpass') {
      const query = await engine.call('query', {
        bounds,
        winter: Boolean(target.winter_mode),
        classes,
      });
      if (serial !== osmLoadSerial || project !== target || controller.signal.aborted) return;
      const data = await loadOsm(query, controller.signal, progress => {
        if (serial === osmLoadSerial && project === target)
          status(progress.message, false, true, progress.attempt, progress.maxAttempts);
      });
      if (serial !== osmLoadSerial || project !== target || controller.signal.aborted) return;
      incoming = (await engine.call('classify', data)).map(feature => ({
        ...feature,
        tags: { ...feature.tags, contour_source: { id: source.id, name: source.name } },
      }));
    } else {
      status(`Loading ${source.name}…`, false, true);
      const download = await downloadFeatureSource(
        source,
        bounds,
        controller.signal,
        fetch,
        classes,
      );
      if (serial !== osmLoadSerial || project !== target || controller.signal.aborted) return;
      incoming = identifySourceFeatures(
        source,
        download,
        await engine.call('classify', download.geojson),
      );
      if (
        !['hrc', 'openskimap'].includes(source.id) &&
        download.geojson.features.length &&
        !incoming.length
      )
        throw new Error(
          'No supported features were found. For untagged data, edit the source and choose a feature type such as Trails.',
        );
    }
    if (serial !== osmLoadSerial || project !== target || controller.signal.aborted) return;
    incoming = incoming.filter(feature => classes.includes(feature.class));
    if (target.winter_mode)
      for (const feature of incoming) {
        if (feature.class === 'trail') feature.enabled = false;
        if (['glacier', 'ski_run', 'ski_lift'].includes(feature.class)) {
          feature.enabled = true;
          feature.treatment = feature.class === 'ski_lift' ? 'v_carve' : 'insert';
        }
      }
    if (source.kind !== 'overpass') {
      target.features = mergeSourceFeatures(target.features, incoming, source, classes);
    } else {
      const existing = new Map(target.features.map(feature => [feature.id, feature]));
      incoming.forEach(feature => {
        const current = existing.get(feature.id);
        if (current) {
          feature.enabled = current.enabled;
          feature.treatment = current.treatment;
        }
        existing.set(feature.id, feature);
      });
      target.features = [...existing.values()];
    }
    touch();
    listFeatures();
    refreshMetrics();
    await updateOverlays();
    if (serial !== osmLoadSerial || project !== target || controller.signal.aborted) return;
    if (overlays.length) markPreviewStage('features');
    if (focusFeatures && incoming.length) setPanel('features');
    osmRetryAvailable = false;
    status(
      source.kind === 'overpass'
        ? `Added ${incoming.length} map ${incoming.length === 1 ? 'feature' : 'features'}. Select any feature to customize it.`
        : incoming.length
          ? `Loaded ${incoming.length} ${incoming.length === 1 ? 'feature' : 'features'} from ${source.name}. Select any feature to customize it.`
          : `No features from ${source.name} match the selected classes in this terrain. Other classes and sources are unchanged.`,
    );
  } catch (e) {
    if (controller.signal.aborted || serial !== osmLoadSerial || project !== target) return;
    osmRetryAvailable = true;
    console.error(e);
    status(
      source.kind === 'overpass'
        ? 'Trails and water could not be loaded right now. Your terrain is ready—use “Retry trails and water” when you are ready.'
        : `${userErrorMessage(e)} Use “Retry source” when ready.`,
      true,
    );
  } finally {
    if (serial === osmLoadSerial) {
      osmLoading = false;
      osmAbort = undefined;
      syncOsmAction();
    }
  }
}
$('fetch-osm').onclick = () => {
  if (!project || busy || osmLoading) return;
  void loadProjectFeatures();
};
$('cancel-feature-source').onclick = () => {
  cancelOsmLoad();
  status('Source download canceled.');
};
sourcePanel = new FeatureSourcePanel(() => {
  osmRetryAvailable = false;
  syncOsmAction();
});
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
  viewer.applyMaterials(project);
  listFeatures();
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
$('normalize-filaments').onclick = () => {
  project.materials = filamentPlan(project).groups;
  touch();
  syncForm();
  viewer.applyMaterials(project);
};
for (const id of [
  'terrain-color',
  'terrain-extruder',
  ...defaultMaterialGroups
    .slice(1)
    .flatMap(group => [`material-${group.id}-color`, `material-${group.id}-extruder`]),
])
  $(id).onchange = () => {
    const previous = project.materials;
    project.materials = [
      {
        id: 'terrain',
        name: 'Terrain',
        color: ($('terrain-color') as HTMLInputElement).value,
        extruder: Number(($('terrain-extruder') as HTMLInputElement).value),
      },
      ...defaultMaterialGroups.slice(1).map(group => ({
        ...group,
        color: ($(`material-${group.id}-color`) as HTMLInputElement).value,
        extruder: Number(($(`material-${group.id}-extruder`) as HTMLInputElement).value),
      })),
    ];
    try {
      filamentPlan(project);
      if (project.settings.manufacturing_mode === 'multicolor' && id.endsWith('-color')) {
        const groupId = id === 'terrain-color' ? 'terrain' : id.slice(9, -6);
        const edited = project.materials.find(group => group.id === groupId)!;
        project.materials = project.materials.map(group =>
          group.extruder === edited.extruder ? { ...group, color: edited.color } : group,
        );
      }
    } catch (e) {
      project.materials = previous;
      syncForm();
      error(e);
      return;
    }
    touch();
    syncForm();
    viewer.applyMaterials(project);
  };
for (const [id, k] of [['quality', 'terrain_max_error_mm']] as const)
  $(id).onchange = () => {
    project.settings[k] = Number(($(id) as HTMLInputElement).value);
    touch();
    $('quality-caption').textContent =
      project.settings.terrain_max_error_mm === 0
        ? 'Uses all source elevation samples'
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
  ['draft-height', 'insert_draft_height_mm'],
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
  $('area-title').textContent = wizardMode ? 'Select model area' : 'Edit model area';
  $('area-load').textContent = wizardMode ? 'Create model' : 'Load terrain';
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
  $('polygon-draw').textContent = editable ? 'Draw boundary' : 'Place center';
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
  cancelOsmLoad();
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
  cancelOsmLoad();
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
    const featureSource = sourcePanel!.selected();
    $('area-dialog').classList.add('hidden');
    updateBusy(true);
    abort = new AbortController();
    const loadingLayout = previewLayout(bounds, prior);
    const loadingBoundary = previewBoundary(loadingLayout, boundary);
    viewer.showLoadingMap(loadingLayout, [...loadingBoundary, loadingBoundary[0]]);
    markPreviewStage('topo', true);
    await nextPreviewPaint();
    $('model-caption').textContent = 'Loading terrain';
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
      name: ($('area-name') as HTMLInputElement).value || 'Untitled model',
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
    $('model-caption').textContent =
      project.settings.terrain_max_error_mm > 0
        ? 'Editing model · adaptive detail'
        : 'Editing model · full source resolution';
    setPanel('terrain');
    wizardMode = false;
    updateBusy(false);
    if (featureChoice === 'none') status('Terrain ready.');
    else {
      status(`Terrain ready. Loading ${featureSource.name} in the background…`, false, true);
      void loadProjectFeatures(true, featureSource);
    }
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
  const packed = await engine.call('preset-pack', { project }, progressStatus),
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
    osmLoading,
    osmRetryAvailable,
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
setupWorkbenchChrome({
  newProject: () => {
    void flushAutosave().then(() => {
      hideLanding();
      openArea(true);
    });
  },
  panel: name => {
    setPanel(name);
    if (name === 'inspect' && asset && asset.revision === revision && !busy)
      $('mode-review').click();
    if (matchMedia('(max-width: 760px)').matches) mobileSettings(true);
  },
});
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

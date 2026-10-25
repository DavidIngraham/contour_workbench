import { featureSource, groupFeaturesBySource } from './feature-sources';
import { gpxPlacement, placementLabels } from './gpx-placement';
import { normalizeClassPriority, type Feature, type Project, type Treatment } from './types';

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const labels: Record<Feature['class'], string> = {
  trail: 'Trails',
  road: 'Roads',
  stream: 'Waterways',
  water: 'Lakes & rivers',
  glacier: 'Glaciers',
  ski_run: 'Ski runs',
  ski_lift: 'Ski lifts',
};
const zone = (f: Feature) =>
  Boolean(f.polygons?.length) || ['water', 'glacier', 'ski_run'].includes(f.class);
type Selection =
  | { kind: 'feature'; id: string }
  | { kind: 'class'; cls: Feature['class'] }
  | { kind: 'source'; cls: Feature['class']; id: string };
interface Actions {
  include: (features: Feature[], enabled: boolean) => void;
  treatment: (features: Feature[], value: Treatment) => void;
  changed: () => void;
  select: (id: string | null) => void;
  zoom: (feature: Feature) => void;
}

/** A feature tree and one properties editor. Selection and search scope are transient UI state. */
export class FeatureBrowser {
  private project?: Project;
  private selection?: Selection;
  private scope = 'all';
  private collapsed = new Set<string>();
  private tree = document.getElementById('feature-list')!;
  private properties = document.getElementById('feature-properties')!;
  private search = document.getElementById('feature-search') as HTMLInputElement;
  private bulkScope = document.getElementById('feature-bulk-scope') as HTMLSelectElement;
  private bulkButton = document.getElementById('all-features') as HTMLButtonElement;

  constructor(private actions: Actions) {
    this.search.addEventListener('input', () => this.refresh());
    this.bulkScope.onchange = () => this.refresh();
    this.bulkButton.onclick = () => {
      const items = this.bulkMembers();
      if (items.length) this.actions.include(items, !items.every(f => f.enabled));
    };
  }

  /** Reveal and select a feature picked in the viewport, even if a search excluded it. */
  selectFeature(id: string | null) {
    this.selection = id ? { kind: 'feature', id } : undefined;
    if (id && this.project) {
      const feature = this.project.features.find(f => f.id === id);
      if (feature) {
        if (!this.matches(feature)) this.search.value = '';
        this.collapsed.delete(feature.class);
        this.collapsed.delete(`${feature.class}:${featureSource(feature).id}`);
      }
    }
    this.refresh();
  }

  /** Update the tree after project edits without storing UI state in the model. */
  render(project: Project) {
    if (this.project !== project) {
      this.selection = undefined;
      this.collapsed.clear();
      this.search.value = '';
      this.scope = 'all';
    }
    this.project = project;
    this.refresh();
  }

  private matches(f: Feature) {
    const term = this.search.value.trim().toLowerCase();
    return `${f.name} ${f.id} ${featureSource(f).name}`.toLowerCase().includes(term);
  }
  private bulkMembers() {
    return (this.project?.features ?? []).filter(
      f => this.bulkScope.value === 'all' || this.matches(f),
    );
  }
  private members() {
    const selection = this.selection;
    return (this.project?.features ?? []).filter(f => {
      if (!selection) return false;
      if (selection.kind === 'feature') return f.id === selection.id;
      return (
        f.class === selection.cls &&
        (selection.kind === 'class' || featureSource(f).id === selection.id)
      );
    });
  }
  private targets() {
    return this.members().filter(
      f => this.scope === 'all' || this.selection?.kind === 'feature' || this.matches(f),
    );
  }
  private choose(selection: Selection) {
    this.selection = selection;
    this.scope = 'all';
    this.actions.select(selection.kind === 'feature' ? selection.id : null);
    this.refresh();
    this.properties.scrollIntoView({ block: 'nearest' });
  }
  private refresh() {
    const project = this.project;
    if (!project) return;
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    const bulk = this.bulkMembers();
    const action = bulk.length && bulk.every(f => f.enabled) ? 'Exclude' : 'Include';
    const noun = this.bulkScope.value === 'all' ? 'feature' : 'result';
    this.bulkButton.textContent = `${action} ${bulk.length === 1 ? `1 ${noun}` : `all ${bulk.length} ${noun}s`}`;
    this.bulkButton.disabled = !bulk.length;
    this.tree.innerHTML =
      normalizeClassPriority(project.settings.class_priority)
        .map(cls => {
          const all = project.features.filter(f => f.class === cls),
            visible = all.filter(f => this.matches(f));
          if (!visible.length) return '';
          const scope = `all ${all.length} ${labels[cls].toLowerCase()}, including filtered features`;
          return `<details class="feature-group" data-tree-key="${cls}" ${this.collapsed.has(cls) ? '' : 'open'}><summary class="group-heading">
        <input id="include-class-${cls}" type="checkbox" data-class="${cls}" aria-label="Include ${scope} in model" title="Affects ${scope}"/>
        <button id="select-class-${cls}" class="tree-name" data-select-class="${cls}" aria-label="Edit ${labels[cls]} properties">${labels[cls]}</button><small>${visible.length}${visible.length === all.length ? '' : `/${all.length}`}</small>
      </summary>${groupFeaturesBySource(visible)
        .map(group => {
          const items = all.filter(f => featureSource(f).id === group.id),
            key = `${cls}:${group.id}`;
          const groupScope = `all ${items.length} ${labels[cls].toLowerCase()} from ${group.name}, including filtered features`;
          return `<details class="feature-source-group" data-feature-source="${esc(group.id)}" data-source-class="${cls}" data-tree-key="${esc(key)}" ${this.collapsed.has(key) ? '' : 'open'}>
          <summary class="feature-source-heading"><input id="include-source-${esc(key)}" type="checkbox" data-source-toggle aria-label="Include ${esc(groupScope)} in model" title="Affects ${esc(groupScope)}"/>
          <button id="select-source-${esc(key)}" class="tree-name" data-select-source="${esc(group.id)}" data-cls="${cls}" aria-label="Edit ${esc(labels[cls])} from ${esc(group.name)} properties">${esc(group.name)}</button><small>${group.features.length}${group.features.length === items.length ? '' : `/${items.length}`}</small></summary>
          ${group.features
            .map(
              f => `<div class="feature-entry ${this.selection?.kind === 'feature' && this.selection.id === f.id ? 'selected' : ''}" data-feature="${esc(f.id)}"><div class="feature-item">
            <input id="include-feature-${esc(f.id)}" type="checkbox" data-toggle="${esc(f.id)}" ${f.enabled ? 'checked' : ''} aria-label="Include ${esc(f.name)} in model"/>
            <button id="select-feature-${esc(f.id)}" class="tree-name" data-select-feature="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</button>
          </div></div>`,
            )
            .join('')}
        </details>`;
        })
        .join('')}</details>`;
        })
        .join('') || '<p class="empty-note">No matching features.</p>';
    this.tree.querySelectorAll<HTMLDetailsElement>('[data-tree-key]').forEach(details => {
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (details.open) this.collapsed.delete(details.dataset.treeKey!);
        else this.collapsed.add(details.dataset.treeKey!);
      });
    });
    this.tree
      .querySelectorAll<HTMLInputElement>('[data-class], [data-source-toggle]')
      .forEach(input => {
        const group = input.closest<HTMLElement>('[data-feature-source]');
        const items = group
          ? project.features.filter(
              f =>
                f.class === group.dataset.sourceClass &&
                featureSource(f).id === group.dataset.featureSource,
            )
          : project.features.filter(f => f.class === input.dataset.class);
        input.checked = items.every(f => f.enabled);
        input.indeterminate = items.some(f => f.enabled) && !input.checked;
        input.onchange = () => this.actions.include(items, input.checked);
      });
    this.tree.querySelectorAll<HTMLInputElement>('[data-toggle]').forEach(input => {
      input.onchange = () =>
        this.actions.include(
          [project.features.find(f => f.id === input.dataset.toggle)!],
          input.checked,
        );
    });
    this.tree.querySelectorAll<HTMLButtonElement>('[data-select-feature]').forEach(button => {
      button.setAttribute(
        'aria-pressed',
        String(
          this.selection?.kind === 'feature' && this.selection.id === button.dataset.selectFeature,
        ),
      );
      button.onclick = () => this.choose({ kind: 'feature', id: button.dataset.selectFeature! });
    });
    this.tree.querySelectorAll<HTMLButtonElement>('[data-select-class]').forEach(button => {
      button.setAttribute(
        'aria-pressed',
        String(
          this.selection?.kind === 'class' && this.selection.cls === button.dataset.selectClass,
        ),
      );
      button.onclick = () =>
        this.choose({ kind: 'class', cls: button.dataset.selectClass as Feature['class'] });
    });
    this.tree.querySelectorAll<HTMLButtonElement>('[data-select-source]').forEach(button => {
      button.setAttribute(
        'aria-pressed',
        String(
          this.selection?.kind === 'source' &&
            this.selection.cls === button.dataset.cls &&
            this.selection.id === button.dataset.selectSource,
        ),
      );
      button.onclick = () =>
        this.choose({
          kind: 'source',
          cls: button.dataset.cls as Feature['class'],
          id: button.dataset.selectSource!,
        });
    });
    this.renderProperties();
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  private renderProperties() {
    const members = this.members(),
      items = this.targets(),
      project = this.project!;
    const single = this.selection?.kind === 'feature' ? members[0] : undefined;
    if (!members.length) {
      this.properties.innerHTML =
        '<h3>Selection properties</h3><p class="help">Select a feature, class, or source group to edit its properties.</p>';
      return;
    }
    const name =
      single?.name ??
      (this.selection?.kind === 'class'
        ? labels[this.selection.cls]
        : `${labels[members[0].class]} · ${featureSource(members[0]).name}`);
    const modes = new Set(items.map(f => (f.treatment === 'v_carve' ? 'v_carve' : 'insert')));
    const together = project.settings.manufacturing_mode === 'multicolor';
    const allZones = items.length > 0 && items.every(zone);
    const mixed = modes.size !== 1;
    this.properties.innerHTML = `<h3>Selection properties</h3><strong class="selection-name">${esc(name)}</strong>
      ${single ? '' : `<label class="section-label" for="selection-scope">Apply changes to</label><select id="selection-scope"><option value="all" ${this.scope === 'all' ? 'selected' : ''}>All ${members.length} group ${members.length === 1 ? 'member' : 'members'}</option><option value="results" ${this.scope === 'results' ? 'selected' : ''}>${members.filter(f => this.matches(f)).length} matching ${members.filter(f => this.matches(f)).length === 1 ? 'result' : 'results'}</option></select>`}
      <p class="help">${single ? 'Applies to this feature.' : `Changes affect ${items.length} ${items.length === 1 ? 'feature' : 'features'}${this.scope === 'all' ? ', including members hidden by search' : ' matching the search'}.`}</p>
      <label class="property-checkbox"><input id="selection-included" type="checkbox" ${items.length && items.every(f => f.enabled) ? 'checked' : ''} ${items.length ? '' : 'disabled'}/> Include in model</label>
      <label class="section-label" for="selection-treatment">Treatment</label><select id="selection-treatment" ${items.length ? '' : 'disabled'}>${mixed ? '<option value="mixed">Mixed</option>' : ''}<option value="insert" ${modes.has('insert') && !mixed ? 'selected' : ''}>${together ? 'Color region' : 'Insert'}</option><option value="v_carve" ${modes.has('v_carve') && !mixed ? 'selected' : ''}>${allZones ? 'Recess' : 'V-carve'}</option></select>
      ${allZones ? this.zoneProperties(items) : ''}
      ${single ? `<button class="btn full-width" id="selection-zoom">Zoom to feature</button>${single.id.startsWith('gpx:') ? `<p class="help gpx-placement" data-placement="${gpxPlacement(single, project.grid.bounds, project.settings.boundary)}">${placementLabels[gpxPlacement(single, project.grid.bounds, project.settings.boundary)]}</p>` : ''}` : ''}`;
    const include = this.properties.querySelector<HTMLInputElement>('#selection-included')!;
    include.indeterminate = items.some(f => f.enabled) && !items.every(f => f.enabled);
    include.onchange = () => this.actions.include(items, include.checked);
    this.properties
      .querySelector<HTMLSelectElement>('#selection-scope')
      ?.addEventListener('change', event => {
        this.scope = (event.target as HTMLSelectElement).value;
        this.refresh();
      });
    this.properties.querySelector<HTMLSelectElement>('#selection-treatment')!.onchange = event => {
      const value = (event.target as HTMLSelectElement).value;
      if (value !== 'mixed') this.actions.treatment(items, value as Treatment);
    };
    this.properties
      .querySelector<HTMLButtonElement>('#selection-zoom')
      ?.addEventListener('click', () => this.actions.zoom(single!));
    this.properties
      .querySelector<HTMLSelectElement>('#selection-surface')
      ?.addEventListener('change', event => {
        const value = (event.target as HTMLSelectElement).value;
        if (value === 'mixed') return;
        items.forEach(f => {
          f.surface = value as Feature['surface'];
        });
        this.actions.changed();
        this.refresh();
      });
    for (const [id, key] of [
      ['selection-depth', 'insert_depth_mm'],
      ['selection-width', 'width_m'],
    ] as const) {
      this.properties
        .querySelector<HTMLInputElement>(`#${id}`)
        ?.addEventListener('change', event => {
          const input = event.target as HTMLInputElement;
          if (!input.value || !input.reportValidity()) return;
          items.forEach(f => {
            f[key] = Number(input.value);
          });
          this.actions.changed();
          this.refresh();
        });
    }
  }
  private zoneProperties(items: Feature[]) {
    const project = this.project!,
      together = project.settings.manufacturing_mode === 'multicolor';
    const surfaces = new Set(items.map(f => f.surface ?? 'terrain'));
    const depths = new Set(
      items.map(f => f.insert_depth_mm ?? project.settings.zone_insert_depth_mm),
    );
    const widths = new Set(items.map(f => f.width_m ?? project.settings.ski_run_width_m));
    return `<label class="section-label" for="selection-surface">Surface</label><select id="selection-surface">${surfaces.size > 1 ? '<option value="mixed">Mixed</option>' : ''}<option value="terrain" ${surfaces.size === 1 && surfaces.has('terrain') ? 'selected' : ''}>Follow terrain</option><option value="level" ${surfaces.size === 1 && surfaces.has('level') ? 'selected' : ''}>Level surface</option></select>
      ${together ? '<p class="help">Color depth is controlled by the slicer.</p>' : `<label class="section-label" for="selection-depth">Insert depth</label><div class="input-wrap"><input id="selection-depth" type="number" min="0.2" max="20" step="0.1" placeholder="Mixed" value="${depths.size === 1 ? [...depths][0] : ''}"/><span>mm</span></div>`}
      ${items.every(f => f.class === 'ski_run' && !f.polygons?.length) ? `<label class="section-label" for="selection-width">Run width</label><div class="input-wrap"><input id="selection-width" type="number" min="1" max="500" step="1" placeholder="Mixed" value="${widths.size === 1 ? [...widths][0] : ''}"/><span>m</span></div>` : ''}`;
  }
}

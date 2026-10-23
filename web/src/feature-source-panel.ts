/** Accessible source-library controls shared with the new-landscape chooser. */
import {
  customFeatureSource,
  defaultFeatureSources,
  readFeatureSources,
  saveFeatureSources,
  sourceClasses,
  readSourceClasses,
  saveSourceClasses,
  type FeatureSource,
} from './feature-sources';
import type { FeatureClass } from './types';

const labels: Record<FeatureClass, string> = {
  trail: 'Trails',
  road: 'Roads',
  stream: 'Waterways',
  water: 'Lakes & rivers',
  glacier: 'Glaciers',
  ski_run: 'Ski runs',
  ski_lift: 'Ski lifts',
};

/** Manage local source preferences without changing a project's imported features. */
export class FeatureSourcePanel {
  private custom: FeatureSource[] = [];
  private select = document.querySelector<HTMLSelectElement>('#feature-source')!;
  private wizard = document.querySelector<HTMLSelectElement>('#wizard-feature-source')!;
  private form = document.querySelector<HTMLFormElement>('#source-form')!;
  private details = document.querySelector<HTMLDetailsElement>('#source-editor')!;
  private message = document.querySelector<HTMLElement>('#source-message')!;
  private editing: string | undefined;
  private disabled = false;
  private classes: Record<string, FeatureClass[]> = {};

  constructor(private changed: () => void) {
    try {
      this.custom = readFeatureSources(localStorage);
      this.classes = readSourceClasses(localStorage);
    } catch {
      /* Storage may be disabled. */
    }
    this.render();
    this.select.onchange = () => {
      this.wizard.value = this.select.value;
      this.changed();
      this.sync();
    };
    this.wizard.onchange = () => {
      this.select.value = this.wizard.value;
      this.changed();
      this.sync();
    };
    document.querySelector<HTMLButtonElement>('#source-new')!.onclick = () => {
      this.editing = undefined;
      this.form.reset();
      this.details.open = true;
      this.field('custom-source-name').focus();
      this.message.textContent = '';
    };
    document.querySelector<HTMLButtonElement>('#source-edit')!.onclick = () => {
      const source = this.selected();
      this.editing = source.id;
      this.field('custom-source-name').value = source.name;
      this.field('source-url').value = source.url;
      this.field('source-class').value = source.featureClass;
      this.field('source-name-field').value = source.nameField;
      this.details.open = true;
      this.field('custom-source-name').focus();
    };
    document.querySelector<HTMLButtonElement>('#source-remove')!.onclick = () => {
      try {
        const next = this.custom.filter(source => source.id !== this.selected().id);
        saveFeatureSources(localStorage, next);
        this.custom = next;
        this.editing = undefined;
        this.form.reset();
        this.details.open = false;
        this.render();
        this.changed();
        this.message.textContent =
          'Source removed from the library. Imported model features are kept.';
      } catch (error) {
        this.message.textContent = (error as Error).message;
      }
    };
    this.form.onsubmit = event => {
      event.preventDefault();
      if (this.disabled) return;
      try {
        const source = customFeatureSource(
          this.field('custom-source-name').value,
          this.field('source-url').value,
          this.field('source-class').value,
          this.field('source-name-field').value,
          this.editing,
        );
        const next = [...this.custom.filter(item => item.id !== source.id), source];
        saveFeatureSources(localStorage, next);
        this.custom = next;
        this.editing = undefined;
        this.form.reset();
        this.details.open = false;
        this.render(source.id);
        this.changed();
        this.message.textContent =
          'Source saved in this browser. Choose Load source to add its features.';
      } catch (error) {
        this.message.textContent = (error as Error).message;
      }
    };
  }

  private field(id: string) {
    return document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  }
  private render(selected = 'overpass') {
    for (const select of [this.select, this.wizard]) {
      select.replaceChildren();
      for (const [label, sources] of [
        ['Default sources', defaultFeatureSources],
        ['Your sources', this.custom],
      ] as const) {
        if (!sources.length) continue;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const source of sources) group.append(new Option(source.name, source.id));
        select.append(group);
      }
      select.value = selected;
    }
    this.sync();
  }
  private sync() {
    const source = this.selected();
    for (const id of ['source-edit', 'source-remove'])
      document.getElementById(id)!.classList.toggle('hidden', !source.id.startsWith('custom:'));
    document.getElementById('source-description')!.textContent =
      (source.description ??
        'Loads lines and polygons in your terrain area. Refreshing replaces this source’s features and keeps matching feature settings.') +
      (source.attribution ? ` ${source.attribution}` : '');
    for (const id of ['source-classes', 'wizard-source-classes']) {
      const fieldset = document.getElementById(id)!;
      fieldset.replaceChildren();
      const legend = document.createElement('legend');
      legend.textContent = 'Classes to load';
      fieldset.append(legend);
      for (const cls of sourceClasses(source)) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = cls;
        input.checked = this.selectedClasses().includes(cls);
        input.disabled = this.disabled;
        input.onchange = () => {
          const selected = new Set(this.selectedClasses());
          if (input.checked) selected.add(cls);
          else selected.delete(cls);
          this.classes[source.id] = [...selected];
          try {
            saveSourceClasses(localStorage, this.classes);
          } catch {
            this.message.textContent =
              'Class choices apply now but could not be saved in this browser.';
          }
          this.sync();
          document.querySelector<HTMLInputElement>(`#${id} input[value="${cls}"]`)?.focus();
          this.changed();
        };
        label.append(input, document.createTextNode(labels[cls]));
        fieldset.append(label);
      }
    }
  }
  /** Snapshot the selected classes for the current source, constrained to its supported classes. */
  selectedClasses(): FeatureClass[] {
    const source = this.selected();
    const available = sourceClasses(source);
    return available.filter(cls => (this.classes[source.id] ?? available).includes(cls));
  }
  /** Resolve the current selection without trusting option text or saved data. */
  selected(): FeatureSource {
    return (
      [...defaultFeatureSources, ...this.custom].find(source => source.id === this.select.value) ??
      defaultFeatureSources[0]
    );
  }
  /** Select the source used by a wizard or winter-mode load. */
  choose(id: string) {
    this.select.value = id;
    this.wizard.value = id;
    this.sync();
  }
  /** Lock source changes while a download or geometry job is running. */
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    for (const id of [
      'feature-source',
      'wizard-feature-source',
      'source-new',
      'source-edit',
      'source-remove',
      'source-save',
    ])
      (document.getElementById(id) as HTMLButtonElement | HTMLSelectElement).disabled = disabled;
    document
      .querySelectorAll<HTMLInputElement>('.source-class-options input')
      .forEach(input => (input.disabled = disabled));
  }
}

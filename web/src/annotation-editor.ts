/** DOM editor for creating and placing printable annotations. */
import * as THREE from 'three';
import { perspectiveFitDistance, type Viewer } from './viewer';
import type { Project, Terrain, Mesh } from './types';
import { displayMaterials } from './filaments';
import {
  annotationGeometry,
  combineMeshes,
  annotationFonts,
  annotationFont,
  annotationFrame,
  annotationPoint,
  boundaryXY,
  type AnnotationFrame,
  type Annotation,
} from './annotations';
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Manages annotation controls, rasterization, selection, and placement callbacks. */
export class AnnotationEditor {
  private group = new THREE.Group();
  private selected = '';
  private placing = false;
  private consumedClick = false;
  private drag?: {
    kind: string;
    x: number;
    y: number;
    angle: number;
    width: number;
    height: number;
    z: number;
    frame: AnnotationFrame;
    center: THREE.Vector3;
    start: THREE.Vector3;
  };
  private ray = new THREE.Raycaster();
  private panel: HTMLElement;
  private warning = '';
  constructor(
    private viewer: Viewer,
    private state: () => { project: Project; terrain: Terrain },
    private changed: () => void,
    private show: () => void,
  ) {
    this.panel = document.getElementById('tab-annotations')!;
    viewer.model.add(this.group);
    this.panel.innerHTML = `<section class="panel"><h3>Annotations</h3><div class="annotation-actions"><button class="btn" id="add-text">Add text</button><button class="btn" id="add-logo">Upload PNG</button></div><input hidden id="annotation-file" type="file" accept="image/png"/><p class="help">Select a label to drag it. Drag the corner to resize or the round handle to rotate. Label platforms snap to a straight model edge.</p><div id="annotation-list"></div></section><section class="panel" id="annotation-form"></section><p class="help" id="annotation-warning" role="status"></p>`;
    this.el('add-text').onclick = () => this.add('text');
    this.el('add-logo').onclick = () => this.el<HTMLInputElement>('annotation-file').click();
    this.el<HTMLInputElement>('annotation-file').onchange = async () => {
      try {
        const f = this.el<HTMLInputElement>('annotation-file').files?.[0];
        if (!f) return;
        if (f.size > 2_000_000) throw new Error('Choose a PNG smaller than 2 MB.');
        const uri = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        const a = this.add('png');
        a.image = uri;
        a.name = f.name;
        await this.raster(a);
        this.form();
        this.commit();
      } catch (e) {
        this.message(String(e));
      }
    };
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener(
      'click',
      e => {
        if (this.consumedClick) {
          e.stopImmediatePropagation();
          this.consumedClick = false;
        }
      },
      true,
    );
    canvas.addEventListener('pointerdown', e => this.down(e), true);
    canvas.addEventListener('pointermove', e => this.move(e), true);
    canvas.addEventListener(
      'pointerup',
      e => {
        if (this.drag) {
          this.drag = undefined;
          viewer.controls.enabled = true;
          canvas.releasePointerCapture(e.pointerId);
          e.stopImmediatePropagation();
          this.form();
        }
      },
      true,
    );
    canvas.addEventListener('pointercancel', () => {
      this.drag = undefined;
      viewer.controls.enabled = true;
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.placing = false;
    });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id) as T;
  }
  /** Placement and drag gestures must finish before an automatic app reload. */
  get interacting() {
    return this.placing || Boolean(this.drag);
  }
  private current() {
    return this.state().project?.annotations?.find(a => a.id === this.selected);
  }
  private message(s: string) {
    this.el('annotation-warning').textContent = s;
  }
  private add(kind: 'text' | 'png') {
    const { project, terrain } = this.state();
    if (!terrain) throw new Error('Load terrain first');
    const a: Annotation = {
      id: crypto.randomUUID(),
      name: kind === 'text' ? 'New label' : 'Logo',
      kind,
      text: 'Label',
      threshold: 128,
      invert: false,
      mask: [],
      pixels_w: 1,
      pixels_h: 1,
      enabled: true,
      placement: 'terrain',
      treatment: 'raised',
      x_mm: terrain.layout.width / 2,
      y_mm: terrain.layout.depth / 2,
      width_mm: 35,
      height_mm: 10,
      angle_deg: 0,
      depth_mm: 0.6,
      porch_depth_mm: 16,
      porch_align: 'base',
    };
    (project.annotations ??= []).push(a);
    this.selected = a.id;
    this.show();
    if (kind === 'text') {
      void this.raster(a).then(() => this.commit());
    }
    this.form();
    return a;
  }
  private async raster(a: Annotation) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    if (a.kind === 'text') {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'black';
      ctx.font = 'bold 144px ' + annotationFont(a.font);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.text.slice(0, 80), 256, 96, 496);
    } else if (a.image) {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('PNG could not be decoded'));
        image.src = a.image!;
      });
      canvas.height = Math.max(32, Math.min(512, Math.round((512 * image.height) / image.width)));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (!a.mask.length) a.height_mm = (a.width_mm * image.height) / image.width;
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    a.pixels_w = canvas.width;
    a.pixels_h = canvas.height;
    a.mask = [];
    for (let i = 0; i < data.length; i += 4) {
      const dark = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722 < a.threshold;
      a.mask.push(data[i + 3] > 128 && (a.invert ? !dark : dark) ? 1 : 0);
    }
    this.maskPreview(a);
  }
  private maskPreview(a: Annotation) {
    const canvas = this.el<HTMLCanvasElement>('annotation-mask');
    if (!canvas) return;
    canvas.width = a.pixels_w;
    canvas.height = a.pixels_h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#294d40';
    a.mask.forEach((v, i) => {
      if (v) ctx.fillRect(i % a.pixels_w, Math.floor(i / a.pixels_w), 1, 1);
    });
  }
  private form() {
    const a = this.current();
    const rows = this.state().project?.annotations || [];
    this.el('annotation-list').innerHTML = rows
      .map(
        a =>
          `<div class="annotation-row"><input type="checkbox" data-visible="${a.id}" ${a.enabled ? 'checked' : ''} aria-label="Show ${esc(a.name)}"/><button class="small-link" data-annotation="${a.id}">${esc(a.name)}</button></div>`,
      )
      .join('');
    this.panel.querySelectorAll<HTMLElement>('[data-annotation]').forEach(
      el =>
        (el.onclick = () => {
          this.selected = el.dataset.annotation!;
          this.form();
          this.refresh();
        }),
    );
    this.panel.querySelectorAll<HTMLInputElement>('[data-visible]').forEach(
      el =>
        (el.onchange = () => {
          rows.find(a => a.id === el.dataset.visible)!.enabled = el.checked;
          this.commit();
        }),
    );
    const host = this.el('annotation-form');
    if (!a) {
      host.innerHTML = '<p class="help">Add text or a PNG to begin.</p>';
      return;
    }
    host.innerHTML = `<label>Name<input id="ann-name" value="${esc(a.name)}"/></label>${a.kind === 'text' ? `<label>Text<input id="ann-text" maxlength="80" value="${esc(a.text)}"/></label>` : `<label>Threshold<input id="ann-threshold" type="range" min="1" max="255" value="${a.threshold}"/></label><label><input id="ann-invert" type="checkbox" ${a.invert ? 'checked' : ''}/> Invert dark / light</label>`}<canvas id="annotation-mask" title="Solid areas in the printable annotation"></canvas><label>Placement<select id="ann-placement"><option value="terrain">Terrain top</option><option value="porch">Attached label platform</option></select></label><label>Treatment<select id="ann-treatment"><option value="raised">Raised</option><option value="engraved">Engraved</option></select></label><button class="btn full-width" id="ann-place">Click model to place</button><div class="annotation-fields">${[['width_mm', 'Width (mm)'], ['height_mm', 'Height (mm)'], ['angle_deg', 'Angle (°)'], ['depth_mm', a.treatment === 'raised' ? 'Raised height (mm)' : 'Engraving depth (mm)'], ...(a.placement === 'porch' ? [['porch_depth_mm', 'Platform depth (mm)']] : [])].map(([key, label]) => `<label>${label}<input data-ann-number="${key}" type="number" step="${key === 'angle_deg' ? '5' : '0.1'}" value="${a[key as keyof Annotation]}"/></label>`).join('')}</div>${a.placement === 'porch' ? `<label>Platform top<select id="ann-align"><option value="base">At base height</option><option value="edge">At terrain edge</option></select></label><p class="help">Width and minimum depth fit the content with a 3 mm margin. Rotation follows the selected edge.</p>` : ''}<div class="annotation-actions"><button class="btn" id="ann-duplicate">Duplicate</button><button class="btn" id="ann-delete">Delete</button></div>`;
    this.el<HTMLInputElement>('ann-name').oninput = e => {
      a.name = (e.target as HTMLInputElement).value;
      this.commit();
    };
    if (a.kind === 'text') {
      const label = document.createElement('label');
      label.textContent = 'Font';
      const picker = document.createElement('select');
      picker.id = 'ann-font';
      for (const [value, name] of Object.entries(annotationFonts))
        picker.add(new Option(name, value));
      picker.value = annotationFont(a.font);
      label.append(picker);
      this.el('ann-text').parentElement!.after(label);
      picker.onchange = async () => {
        a.font = annotationFont(picker.value);
        await this.raster(a);
        this.commit();
      };
      this.el<HTMLInputElement>('ann-text').oninput = async e => {
        a.text = (e.target as HTMLInputElement).value;
        await this.raster(a);
        this.commit();
      };
    } else {
      this.el<HTMLInputElement>('ann-threshold').oninput = async e => {
        a.threshold = Number((e.target as HTMLInputElement).value);
        await this.raster(a);
        this.commit();
      };
      this.el<HTMLInputElement>('ann-invert').onchange = async e => {
        a.invert = (e.target as HTMLInputElement).checked;
        await this.raster(a);
        this.commit();
      };
    }
    this.el<HTMLSelectElement>('ann-treatment').add(new Option('Insert', 'insert'));
    const placement = this.el<HTMLSelectElement>('ann-placement');
    placement.add(new Option('Model bottom', 'bottom'));
    placement.add(new Option('Model side', 'side'));
    if (a.placement === 'terrain') {
      const label = document.createElement('label');
      label.innerHTML = `<input id="ann-drape" type="checkbox" ${a.drape !== false ? 'checked' : ''}/> Follow terrain (drape)`;
      placement.parentElement!.after(label);
      this.el<HTMLInputElement>('ann-drape').onchange = e => {
        a.drape = (e.target as HTMLInputElement).checked;
        this.form();
        this.commit();
      };
      const help = document.createElement('p');
      help.className = 'help';
      help.textContent =
        'Turn off draping for a flat top on raised text and inserts, or a flat engraving floor. Flat raised artwork reaches above the highest terrain under it; flat engraving cuts below the lowest point.';
      label.after(help);
    }
    if (a.placement === 'side') {
      const label = document.createElement('label');
      label.textContent = 'Model side';
      const picker = document.createElement('select');
      picker.id = 'ann-side';
      const { project, terrain } = this.state();
      const poly = boundaryXY(project.settings, terrain.layout);
      poly.forEach((point, i) => {
        const next = poly[(i + 1) % poly.length];
        picker.add(
          new Option(
            `Side ${i + 1} (${Math.hypot(next[0] - point[0], next[1] - point[1]).toFixed(1)} mm)`,
            String(i),
          ),
        );
      });
      picker.value = String(a.side_index ?? 0);
      label.append(picker);
      placement.parentElement!.after(label);
      picker.onchange = () => {
        a.side_index = Number(picker.value);
        this.centerOnSide(a);
        this.form();
        this.commit();
        this.viewFace(a);
      };
      const height = document.createElement('label');
      height.innerHTML = `Height from bottom (mm)<input data-ann-number="z_mm" type="number" step="0.1" min="0" value="${a.z_mm ?? terrain.layout.base_height / 2}"/>`;
      host.querySelector('.annotation-fields')!.append(height);
      const help = document.createElement('p');
      help.className = 'help';
      help.textContent =
        'Text reads from outside the model. Keep it between the bottom and terrain edge; increase the base height if more space is needed.';
      label.after(help);
    }
    const view = document.createElement('button');
    view.className = 'btn full-width';
    view.id = 'ann-view';
    view.textContent = 'View annotation face';
    this.el('ann-place').after(view);
    view.onclick = () => this.viewFace(a);
    if (a.as_insert) {
      const depthInput = host.querySelector<HTMLInputElement>('[data-ann-number="depth_mm"]')!;
      depthInput.parentElement!.firstChild!.textContent = 'Height above surface (mm)';
      depthInput.min = '0';
      const depth = document.createElement('label');
      depth.innerHTML = `Pocket depth (mm)<input data-ann-number="insert_depth_mm" type="number" min="0.2" max="10" step="0.1" value="${a.insert_depth_mm ?? this.state().project.settings.insert_depth_mm}"/>`;
      host.querySelector('.annotation-fields')!.append(depth);
      const help = document.createElement('p');
      help.className = 'help';
      help.textContent =
        'Each disconnected letter or artwork region becomes a separate insert with a flat bottom. Pocket clearance, taper, and annotation color are in Print setup. ' +
        (a.placement === 'terrain' && a.drape === false
          ? 'Height 0 levels the top with the highest terrain under the artwork. '
          : 'Set height to 0 for a flush inlay. ') +
        'Print-together mode uses the annotation color on the assembled model.';
      depth.parentElement!.after(help);
    }
    for (const key of ['placement', 'treatment'] as const) {
      this.el<HTMLSelectElement>('ann-' + key).value =
        key === 'treatment' && a.as_insert ? 'insert' : a[key];
      this.el<HTMLSelectElement>('ann-' + key).onchange = e => {
        const value = (e.target as HTMLSelectElement).value;
        if (key === 'treatment') {
          a.as_insert = value === 'insert';
          a.treatment = value === 'engraved' ? 'engraved' : 'raised';
          if (!a.as_insert && a.depth_mm === 0) a.depth_mm = 0.6;
        } else {
          const previous = a.placement;
          a.placement = value as Annotation['placement'];
          if (a.placement === 'side') this.centerOnSide(a);
          else if (previous === 'side') {
            const { layout } = this.state().terrain;
            a.x_mm = layout.width / 2;
            a.y_mm = layout.depth / 2;
          }
        }
        this.form();
        this.commit();
        if (key === 'placement') this.viewFace(a);
      };
    }
    host.querySelectorAll<HTMLInputElement>('[data-ann-number]').forEach(el => {
      el.disabled = el.dataset.annNumber === 'angle_deg' && a.placement === 'porch';
      el.oninput = () => {
        const v = Number(el.value);
        if (
          Number.isFinite(v) &&
          (el.dataset.annNumber === 'angle_deg' ||
            (a.as_insert && el.dataset.annNumber === 'depth_mm' ? v >= 0 : v > 0))
        ) {
          (a as any)[el.dataset.annNumber!] = v;
          this.commit();
        }
      };
    });
    if (a.placement === 'porch') {
      this.el<HTMLSelectElement>('ann-align').value = a.porch_align;
      this.el<HTMLSelectElement>('ann-align').onchange = e => {
        a.porch_align = (e.target as HTMLSelectElement).value as any;
        this.commit();
      };
    }
    this.el('ann-place').onclick = () => {
      this.placing = true;
      this.message(
        'Click the selected model face to place the annotation; platforms snap to the nearest suitable edge.',
      );
    };
    this.el('ann-delete').onclick = () => {
      this.state().project.annotations = rows.filter(x => x.id !== a.id);
      this.selected = '';
      this.form();
      this.commit();
    };
    this.el('ann-duplicate').onclick = () => {
      const copy = structuredClone(a);
      copy.id = crypto.randomUUID();
      copy.name += ' copy';
      const { project, terrain } = this.state();
      const frame = annotationFrame(a, project.settings, terrain.layout);
      copy.x_mm += frame.u[0] * 5;
      copy.y_mm += frame.u[1] * 5;
      rows.push(copy);
      this.selected = copy.id;
      this.form();
      this.commit();
    };
    this.maskPreview(a);
  }
  private centerOnSide(a: Annotation) {
    const { project, terrain } = this.state(),
      poly = boundaryXY(project.settings, terrain.layout);
    const index = (a.side_index ?? 0) < poly.length ? (a.side_index ?? 0) : 0,
      p = poly[index],
      q = poly[(index + 1) % poly.length];
    if (!p || !q) return;
    a.side_index = index;
    a.x_mm = (p[0] + q[0]) / 2;
    a.y_mm = (p[1] + q[1]) / 2;
    a.z_mm ??= terrain.layout.base_height / 2;
  }
  private viewFace(a: Annotation) {
    const { project, terrain } = this.state();
    let frame: AnnotationFrame;
    try {
      frame = annotationFrame(a, project.settings, terrain.layout);
    } catch (error) {
      this.message((error as Error).message);
      return;
    }
    let center =
      a.placement === 'side'
        ? [a.x_mm, a.y_mm, a.z_mm ?? terrain.layout.base_height / 2]
        : [a.x_mm, a.y_mm, a.placement === 'bottom' ? 0 : terrain.layout.base_height];
    try {
      center = annotationGeometry(a, project.grid, project.settings, terrain.layout).center;
    } catch {
      /* Keep the face accessible while dimensions are being corrected. */
    }
    const target = this.viewer.model.localToWorld(new THREE.Vector3(...center));
    const distance = Math.max(
      35,
      perspectiveFitDistance(
        Math.hypot(a.width_mm, a.height_mm) / 2 + 5,
        this.viewer.camera.aspect,
        this.viewer.camera.fov,
      ),
    );
    this.viewer.controls.target.copy(target);
    // A small offset avoids the OrbitControls pole singularity on top/bottom views.
    this.viewer.camera.position
      .copy(target)
      .addScaledVector(new THREE.Vector3(...frame.n), distance)
      .addScaledVector(
        new THREE.Vector3(...frame.v),
        (a.placement === 'bottom' ? 1 : -1) * distance * 0.02,
      );
    this.viewer.controls.update();
    this.viewer.invalidate();
  }
  private porchMaterial(a: Annotation, center: number[], angle: number) {
    const material = new THREE.MeshStandardMaterial({ color: 0x819981, roughness: 0.9 });
    if (a.treatment !== 'engraved' && !a.as_insert) return material;
    const canvas = document.createElement('canvas');
    canvas.width = a.pixels_w;
    canvas.height = a.pixels_h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    a.mask.forEach((v, i) => {
      if (v) ctx.fillRect(i % a.pixels_w, Math.floor(i / a.pixels_w), 1, 1);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    material.userData.annotationTexture = texture;
    material.onBeforeCompile = shader => {
      shader.uniforms.annotationMask = { value: texture };
      shader.uniforms.annotationCenter = { value: new THREE.Vector2(center[0], center[1]) };
      shader.uniforms.annotationSize = { value: new THREE.Vector2(a.width_mm, a.height_mm) };
      shader.uniforms.annotationRotation = {
        value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)),
      };
      shader.vertexShader =
        'varying vec3 annotationPosition;varying float annotationTop;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nannotationPosition=position;annotationTop=normal.z;',
      );
      shader.fragmentShader =
        'varying vec3 annotationPosition;varying float annotationTop;uniform sampler2D annotationMask;uniform vec2 annotationCenter;uniform vec2 annotationSize;uniform vec2 annotationRotation;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nvec2 delta=annotationPosition.xy-annotationCenter;\nvec2 uv=vec2(delta.x*annotationRotation.x+delta.y*annotationRotation.y,-delta.x*annotationRotation.y+delta.y*annotationRotation.x)/annotationSize+0.5;\nif(annotationTop>0.1&&uv.x>=0.0&&uv.x<=1.0&&uv.y>=0.0&&uv.y<=1.0&&texture2D(annotationMask,uv).r>0.5)discard;',
      );
    };
    return material;
  }

  private commit() {
    this.changed();
    this.refresh();
    const a = this.current();
    if (a) {
      const row = this.panel.querySelector<HTMLElement>('[data-annotation="' + a.id + '"]');
      if (row) row.textContent = a.name;
    }
  }
  refresh(review = false) {
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const material = o.material as THREE.Material;
        material.userData.annotationTexture?.dispose();
        material.dispose();
      }
    });
    this.group.clear();
    this.group.visible = !review;
    this.warning = '';
    const { project, terrain } = this.state();
    if (!terrain || review) return;
    const cuts: Mesh[] = [];
    const faceCuts: Parameters<Viewer['annotationFaceCuts']>[0] = [];
    for (const a of project.annotations || []) {
      if (!a.enabled || !a.mask.length) continue;
      try {
        const g = annotationGeometry(a, project.grid, project.settings, terrain.layout);
        if (a.treatment === 'engraved') {
          if (a.placement === 'bottom' || a.placement === 'side')
            faceCuts.push({ annotation: a, frame: g.frame, center: g.center, angle: g.angle });
          else if (a.placement === 'terrain') cuts.push(...g.preview);
        }
        const mesh = new THREE.Mesh(
          this.viewer.geometry(combineMeshes(g.preview)),
          new THREE.MeshStandardMaterial({
            color: a.as_insert
              ? displayMaterials(project).find(group => group.id === 'annotations')!.color
              : a.treatment === 'raised'
                ? 0xdcc291
                : 0x233c30,
            roughness: 0.85,
            flatShading: Boolean(a.as_insert),
            polygonOffset: Boolean(a.as_insert),
            polygonOffsetFactor: 0,
            polygonOffsetUnits: -2,
          }),
        );
        mesh.userData.annotation = a.id;
        // Flush inlays need render-only separation; exported surfaces stay exact.
        if (a.as_insert) mesh.position.fromArray(g.frame.n).multiplyScalar(0.005);
        this.group.add(mesh);
        if (g.porch) {
          const porch = new THREE.Mesh(
            this.viewer.geometry(g.porch),
            this.porchMaterial(a, g.center, g.angle),
          );
          porch.userData.annotation = a.id;
          this.group.add(porch);
        }
        if (a.id === this.selected) {
          const center = new THREE.Vector3(...g.center);
          const local = (x: number, y: number) =>
            center
              .clone()
              .addScaledVector(new THREE.Vector3(...g.frame.u), x)
              .addScaledVector(new THREE.Vector3(...g.frame.v), y)
              .addScaledVector(new THREE.Vector3(...g.frame.n), a.depth_mm + 0.2);
          const c = Math.cos(g.angle),
            s = Math.sin(g.angle);
          const points = [
            [-a.width_mm / 2, -a.height_mm / 2],
            [a.width_mm / 2, -a.height_mm / 2],
            [a.width_mm / 2, a.height_mm / 2],
            [-a.width_mm / 2, a.height_mm / 2],
            [-a.width_mm / 2, -a.height_mm / 2],
          ].map(([x, y]) => local(x * c - y * s, x * s + y * c));
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0xff9b43, depthTest: false }),
          );
          line.renderOrder = 100;
          this.group.add(line);
          for (const kind of a.placement === 'porch' ? ['resize'] : ['resize', 'rotate']) {
            const handle = new THREE.Mesh(
              new THREE.SphereGeometry(1.4, 12, 8),
              new THREE.MeshBasicMaterial({
                color: kind === 'resize' ? 0xff9b43 : 0x426bce,
                depthTest: false,
              }),
            );
            handle.position.copy(
              kind === 'resize'
                ? points[2]
                : local(-s * (a.height_mm / 2 + 6), c * (a.height_mm / 2 + 6)),
            );
            handle.userData = { annotation: a.id, handle: kind, center };
            handle.renderOrder = 101;
            this.group.add(handle);
          }
        }
      } catch (e) {
        this.warning = (e as Error).message;
      }
    }
    this.viewer.annotationCuts(cuts);
    this.viewer.annotationFaceCuts(faceCuts);
    this.message(this.warning);
    this.viewer.invalidate();
  }
  sync() {
    if (!this.current()) this.selected = '';
    this.form();
    this.refresh();
  }
  private cast(e: PointerEvent) {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.viewer.camera,
    );
  }
  private plane(center: THREE.Vector3, frame: AnnotationFrame) {
    const p = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(...frame.n),
        this.viewer.model.localToWorld(center.clone()),
      ),
      p,
    );
    return hit ? this.viewer.model.worldToLocal(p) : undefined;
  }
  private down(e: PointerEvent) {
    if (!this.group.visible || e.button !== 0) return;
    this.cast(e);
    if (this.placing) {
      this.consumedClick = true;
      const hit = this.ray.intersectObjects(this.viewer.land.children, true)[0];
      if (hit && this.current()) {
        const p = this.viewer.model.worldToLocal(hit.point);
        const a = this.current()!;
        a.x_mm = p.x;
        a.y_mm = p.y;
        if (a.placement === 'side') a.z_mm = p.z;
        this.placing = false;
        this.commit();
      }
      e.stopImmediatePropagation();
      return;
    }
    const hit = this.ray
      .intersectObjects(this.group.children, true)
      .find(h => h.object.userData.annotation);
    if (!hit) return;
    this.consumedClick = true;
    this.selected = hit.object.userData.annotation;
    const a = this.current()!;
    const { project, terrain } = this.state();
    const frame = annotationFrame(a, project.settings, terrain.layout);
    const center =
      (hit.object.userData.center as THREE.Vector3 | undefined) ||
      this.viewer.model.worldToLocal(hit.point.clone());
    this.drag = {
      kind: hit.object.userData.handle || 'move',
      x: a.x_mm,
      y: a.y_mm,
      angle: a.angle_deg,
      width: a.width_mm,
      height: a.height_mm,
      z: a.z_mm ?? terrain.layout.base_height / 2,
      frame,
      center,
      start: this.plane(center, frame) ?? center.clone(),
    };
    this.viewer.controls.enabled = false;
    this.viewer.renderer.domElement.setPointerCapture(e.pointerId);
    e.stopImmediatePropagation();
    this.show();
    this.form();
    this.refresh();
  }
  private move(e: PointerEvent) {
    if (!this.drag) return;
    this.cast(e);
    const a = this.current()!,
      d = this.drag,
      p = this.plane(d.center, d.frame);
    if (!p) return;
    if (d.kind === 'move') {
      a.x_mm = d.x + p.x - d.start.x;
      a.y_mm = d.y + p.y - d.start.y;
      if (a.placement === 'side') a.z_mm = d.z + p.z - d.start.z;
    } else if (d.kind === 'rotate') {
      const point = annotationPoint(d.frame, p.toArray(), true),
        center = annotationPoint(d.frame, d.center.toArray(), true),
        start = annotationPoint(d.frame, d.start.toArray(), true);
      a.angle_deg =
        d.angle +
        ((Math.atan2(point[1] - center[1], point[0] - center[0]) -
          Math.atan2(start[1] - center[1], start[0] - center[0])) *
          180) /
          Math.PI;
    } else {
      const ratio = p.distanceTo(d.center) / Math.max(0.1, d.start.distanceTo(d.center));
      a.width_mm = Math.max(2, d.width * ratio);
      a.height_mm = Math.max(2, d.height * ratio);
    }
    this.commit();
    e.stopImmediatePropagation();
  }
}

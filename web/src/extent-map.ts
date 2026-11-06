/** Leaflet-based terrain extent drawing and editing. */
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { polygonBounds, validatePolygon, type Vertex } from './polygon';
import {
  regularShape,
  rotatePolygon,
  extentPolygon,
  localFrame,
  type Shape,
  type ExtentEditorState,
} from './extent-shapes';
import type { Bounds } from './types';
/** Interactive slippy-map editor for freeform and regular terrain extents. */
export class ExtentMap {
  private map: L.Map;
  private shapes = L.layerGroup();
  private tiles: L.TileLayer;
  private tileFailed = false;
  private tileTimer: ReturnType<typeof setTimeout> | undefined;
  private points: Vertex[] = [];
  private drawing = false;
  private placing = false;
  private shape: Shape = 'freeform';
  private widthM = 2000;
  private heightM = 1500;
  private angle = 0;
  private radiusM = 0;
  private maxPrintSizeMm: [number, number] = [248, 198];
  private center: Vertex = [-121.64, 45.68];
  private beforeDraw: Vertex[] = [];
  private beforeDrawAngle = 0;
  private selectedCorner = -1;
  constructor(
    private host: HTMLElement,
    private changed: (points: Vertex[], message: string, valid: boolean) => void,
  ) {
    this.map = L.map(host, { doubleClickZoom: false, worldCopyJump: true }).setView(
      [45.68, -121.64],
      12,
    );
    this.tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    this.tiles.on('loading', () => {
      this.tileFailed = false;
      this.tileFeedback('Loading map…');
      clearTimeout(this.tileTimer);
      this.tileTimer = setTimeout(() => {
        this.tileFailed = true;
        this.tileFeedback('Map is taking too long to load. Check your connection or retry.', true);
      }, 12000);
    });
    this.tiles.on('tileerror', () => {
      this.tileFailed = true;
      this.tileFeedback('Some map tiles could not load. You can retry or use coordinates.', true);
    });
    this.tiles.on('load', () => {
      clearTimeout(this.tileTimer);
      if (!this.tileFailed) this.tileFeedback('Map ready.');
    });
    this.tiles.addTo(this.map);
    this.shapes.addTo(this.map);
    host.tabIndex = 0;
    host.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.finish();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && this.drawing) {
        e.preventDefault();
        this.undo();
      }
    });
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.placing) {
        this.center = [e.latlng.lng, e.latlng.lat];
        this.placing = false;
        this.generate();
      } else if (this.drawing) {
        this.points.push([e.latlng.lng, e.latlng.lat]);
        this.render();
      }
    });
  }
  private tileFeedback(message: string, retry = false) {
    const status = document.getElementById('map-tile-status');
    if (status) status.textContent = message;
    document.getElementById('map-tile-retry')?.classList.toggle('hidden', !retry);
  }
  /** Retry tile downloads without discarding the current boundary. */
  retryTiles() {
    this.tiles.redraw();
  }
  /** Relocate the draft boundary, preserving meter dimensions and the selected shape. */
  moveTo(center: Vertex) {
    this.cancel();
    const previous = localFrame(this.points.length ? this.points : [this.center]);
    const next = localFrame([center]);
    this.points = this.points.map(point => next.toGeo(previous.toXY(point)));
    this.center = center;
    this.generate();
    this.locate(polygonBounds(this.value()));
  }
  open(
    bounds: Bounds,
    points: Vertex[],
    state?: ExtentEditorState,
    maxPrintSizeMm: [number, number] = [248, 198],
  ) {
    this.points = structuredClone(points);
    this.selectedCorner = -1;
    this.maxPrintSizeMm = [...maxPrintSizeMm];
    this.shape = 'freeform';
    this.angle = 0;
    this.radiusM = 0;
    this.drawing = false;
    this.placing = false;
    this.center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    if (state) {
      this.points = structuredClone(state.points);
      this.shape = state.shape;
      this.center = state.center;
      this.widthM = state.width_m;
      this.heightM = state.height_m;
      this.angle = state.angle_deg;
      this.radiusM = state.corner_radius_m;
    }
    this.map.invalidateSize();
    this.map.fitBounds(
      [
        [bounds[1], bounds[0]],
        [bounds[3], bounds[2]],
      ],
      { padding: [35, 35], animate: false },
    );
    this.render();
  }
  locate(bounds: Bounds) {
    this.map.fitBounds(
      [
        [bounds[1], bounds[0]],
        [bounds[3], bounds[2]],
      ],
      { padding: [35, 35] },
    );
  }
  configure(shape: Shape, widthM: number, heightM: number, angle: number, radiusM: number) {
    if (
      ![widthM, heightM, angle, radiusM].every(Number.isFinite) ||
      widthM <= 0 ||
      heightM <= 0 ||
      radiusM < 0
    ) {
      this.changed([], 'Use positive dimensions and a nonnegative radius.', false);
      return;
    }
    const switching = shape !== this.shape;
    if (switching && shape !== 'freeform' && shape !== 'spline') {
      const c = this.map.getCenter();
      this.center = [c.lng, c.lat];
    }
    this.shape = shape;
    this.widthM = widthM;
    this.heightM = heightM;
    this.angle = angle;
    this.radiusM = radiusM;
    this.drawing = false;
    this.placing = false;
    if (this.editable()) this.render();
    else this.generate();
  }
  private editable() {
    return this.shape === 'freeform' || this.shape === 'spline';
  }
  private generate() {
    if (!this.editable())
      this.points = regularShape(
        this.shape as 'square' | 'rectangle' | 'circle',
        this.center,
        this.widthM,
        this.heightM,
        0,
      );
    this.render();
  }
  start() {
    this.beforeDraw = structuredClone(this.points);
    this.beforeDrawAngle = this.angle;
    if (this.editable()) {
      this.points = [];
      this.angle = 0;
      this.drawing = true;
    } else this.placing = true;
    this.render();
    this.host.focus();
  }
  /** Discard an unfinished replacement boundary and return to the previous outline. */
  cancel() {
    if (this.drawing) {
      this.points = this.beforeDraw;
      this.angle = this.beforeDrawAngle;
    }
    this.drawing = false;
    this.placing = false;
    this.render();
  }
  /** Remove the selected corner while retaining a valid minimum vertex count. */
  removeCorner() {
    if (this.selectedCorner < 0 || this.points.length <= 3) return;
    this.points.splice(this.selectedCorner, 1);
    this.selectedCorner = -1;
    this.render();
  }
  undo() {
    if (this.editable()) {
      this.points.pop();
      this.render();
    }
  }
  finish() {
    try {
      validatePolygon(this.value());
      this.drawing = false;
      this.placing = false;
      this.render();
    } catch (e) {
      this.changed([], (e as Error).message, false);
    }
  }
  state(): ExtentEditorState {
    return {
      shape: this.shape,
      points: structuredClone(this.points),
      center: [...this.center],
      width_m: this.widthM,
      height_m: this.heightM,
      angle_deg: this.angle,
      corner_radius_m: this.radiusM,
    };
  }
  value() {
    return extentPolygon(this.state(), this.maxPrintSizeMm);
  }
  bounds() {
    return polygonBounds(this.value());
  }
  private render() {
    this.host.dispatchEvent(
      new CustomEvent('extent-mode', {
        detail: {
          drawing: this.drawing || this.placing,
          canRemove: this.editable() && this.selectedCorner >= 0 && this.points.length > 3,
        },
      }),
    );
    this.shapes.clearLayers();
    let value: Vertex[];
    try {
      value = this.value();
    } catch (e) {
      this.changed([], (e as Error).message, false);
      return;
    }
    const outline =
      value.length > 1
        ? L.polygon(
            value.map(([lng, lat]) => L.latLng(lat, lng)),
            { color: '#d77735', weight: 3, fillOpacity: 0.18, interactive: false },
          ).addTo(this.shapes)
        : undefined;
    const updateOutline = () => {
      if (!this.editable())
        this.points = regularShape(
          this.shape as 'square' | 'rectangle' | 'circle',
          this.center,
          this.widthM,
          this.heightM,
          0,
        );
      outline?.setLatLngs(this.value().map(([lng, lat]) => L.latLng(lat, lng)));
      this.host.dispatchEvent(new CustomEvent('extent-edit', { detail: this.state() }));
    };
    if (this.editable()) {
      rotatePolygon(this.points, this.angle).forEach((p, i) => {
        const marker = L.marker([p[1], p[0]], {
          draggable: true,
          autoPanOnFocus: false,
          bubblingMouseEvents: false,
          title: `Corner ${i + 1}: drag to move; right-click to remove`,
          icon: L.divIcon({
            className: 'extent-vertex' + (this.selectedCorner === i ? ' selected' : ''),
            html: String(i + 1),
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(this.shapes);
        marker.on('drag', () => {
          const displayed = rotatePolygon(this.points, this.angle);
          const q = marker.getLatLng();
          displayed[i] = [q.lng, q.lat];
          this.points = displayed;
          this.angle = 0;
          updateOutline();
        });
        marker.on('dragend', () => this.render());
        marker.on('contextmenu', () => {
          if (this.points.length <= 3) return;
          this.points.splice(i, 1);
          this.render();
        });
        marker.on('click', () => {
          if (i === 0 && this.drawing && this.points.length >= 3) this.finish();
          else if (!this.drawing) {
            this.selectedCorner = i;
            this.render();
          }
        });
      });
      if (!this.drawing && this.points.length >= 3) {
        const displayed = rotatePolygon(this.points, this.angle);
        displayed.forEach((p, i) => {
          const q = displayed[(i + 1) % displayed.length];
          const middle: Vertex = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const add = L.marker([middle[1], middle[0]], {
            autoPanOnFocus: false,
            keyboard: false,
            bubblingMouseEvents: false,
            title: 'Add corner',
            icon: L.divIcon({
              className: 'extent-midpoint-marker',
              html: `<button type="button" class="extent-midpoint" aria-label="Add corner after ${i + 1}">+</button>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          }).addTo(this.shapes);
          const button = add.getElement()!.querySelector('button')!;
          // Adding a corner is a command, not a map gesture. Keep its native
          // pointer/keyboard activation independent of Leaflet drag suppression.
          L.DomEvent.disableClickPropagation(button);
          button.onclick = () => {
            displayed.splice(i + 1, 0, middle);
            this.points = displayed;
            this.angle = 0;
            this.selectedCorner = i + 1;
            this.render();
          };
        });
      }
    } else {
      const marker = L.marker([this.center[1], this.center[0]], {
        draggable: true,
        autoPanOnFocus: false,
        icon: L.divIcon({
          className: 'extent-vertex extent-center',
          html: '✥',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(this.shapes);
      marker.on('drag', () => {
        const p = marker.getLatLng();
        this.center = [p.lng, p.lat];
        updateOutline();
      });
      marker.on('dragend', () => this.generate());
      this.addHandles(updateOutline);
    }
    let valid = false,
      message = this.placing
        ? 'Click the map to place the center.'
        : this.drawing
          ? `${this.points.length} corners · Click to add. Click the first corner or press Enter to finish. Esc cancels.`
          : this.editable()
            ? `${this.points.length} corners · Drag to move. Click + to add. Select a corner, then Remove corner to delete.`
            : 'Drag the center to move the shape. Drag edge handles to resize; click ↻ to turn 15° or drag it to rotate.';
    try {
      validatePolygon(value);
      valid = !this.drawing && !this.placing;
      if (this.radiusM > 0 && this.shape !== 'circle')
        message += ' Corner radius is limited where edges are short.';
    } catch (e) {
      if (value.length >= 3) message = (e as Error).message;
    }
    this.changed(value, message, valid);
  }
  private addHandles(update: () => void) {
    const frame = localFrame([this.center]),
      angle = (this.angle * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const geo = (x: number, y: number) => frame.toGeo([x * c + y * s, -x * s + y * c]);
    const marker = (point: Vertex, kind: string, html: string, title: string) =>
      L.marker([point[1], point[0]], {
        draggable: true,
        autoPanOnFocus: false,
        bubblingMouseEvents: false,
        title,
        icon: L.divIcon({
          className: 'extent-vertex extent-' + kind,
          html,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      }).addTo(this.shapes);
    const h = this.shape === 'rectangle' ? this.heightM : this.widthM;
    for (const [x, y, axis] of [
      [this.widthM / 2, 0, 'width'],
      [-this.widthM / 2, 0, 'width'],
      [0, h / 2, 'height'],
      [0, -h / 2, 'height'],
    ] as const) {
      const handle = marker(geo(x, y), 'resize', '↔', 'Drag to resize ' + axis);
      handle.on('drag', () => {
        const q = handle.getLatLng(),
          [dx, dy] = frame.toXY([q.lng, q.lat]);
        const localX = dx * c - dy * s,
          localY = dx * s + dy * c;
        if (this.shape === 'circle') this.widthM = Math.max(1, 2 * Math.hypot(dx, dy));
        else if (axis === 'width' || this.shape === 'square')
          this.widthM = Math.max(1, 2 * Math.abs(axis === 'width' ? localX : localY));
        else this.heightM = Math.max(1, 2 * Math.abs(localY));
        update();
      });
      handle.on('dragend', () => this.render());
    }
    if (this.shape === 'circle') return;
    const centerPixel = this.map.latLngToLayerPoint([this.center[1], this.center[0]]),
      r = 48;
    const location = this.map.layerPointToLatLng(
      centerPixel.add(
        L.point(Math.cos(angle - Math.PI / 4) * r, Math.sin(angle - Math.PI / 4) * r),
      ),
    );
    const rotate = marker(
      [location.lng, location.lat],
      'rotate',
      '↻',
      'Click to rotate 15°; drag for any angle',
    );
    rotate.on('click', () => {
      this.angle = (this.angle + 15) % 360;
      update();
      this.render();
    });
    rotate.on('drag', () => {
      const q = this.map.latLngToLayerPoint(rotate.getLatLng());
      this.angle =
        ((Math.atan2(q.y - centerPixel.y, q.x - centerPixel.x) * 180) / Math.PI + 405) % 360;
      update();
    });
    rotate.on('dragend', () => this.render());
  }
}

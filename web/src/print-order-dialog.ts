/** Customer-owned Marketiger ordering, entirely in the browser. */
import { ExportClient } from './export-client';
import type { ExportResult } from './export-formats';
import {
  MarketigerClient,
  MarketigerError,
  euros,
  orderStatus,
  paymentLink,
  validatePrintQuote,
  type PrintModel,
  type ShippingMethod,
} from './marketiger-api';
import { projectMaterialGroups, type Asset, type Project } from './types';

interface Receipt {
  fingerprint: string;
  projectId: string;
  filename: string;
  modelId?: string;
  orderId?: string;
  pending?: 'upload' | 'order';
}
const storageKey = 'contour-marketiger-receipt-v1';
function readReceipt(): Receipt | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (
      value &&
      typeof value.fingerprint === 'string' &&
      typeof value.projectId === 'string' &&
      typeof value.filename === 'string'
    )
      return value;
  } catch {
    /* Storage unavailable. */
  }
}
/** Owns the modal lifetime and aborts stale work when project geometry changes. */
export class PrintOrderDialog {
  private dialog = document.createElement('dialog');
  private api = new MarketigerClient();
  private abort = new AbortController();
  private generation = 0;
  private output?: ExportResult;
  private fingerprint = '';
  private receipt?: Receipt;
  private model?: PrintModel;
  private working = false;
  private message!: HTMLElement;
  private content!: HTMLElement;
  constructor(private snapshot: () => { asset: Asset; project: Project } | undefined) {
    this.dialog.className = 'print-order-dialog';
    this.dialog.setAttribute('aria-label', 'Order a full-color print');
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => this.reset());
    this.dialog.addEventListener('cancel', () => this.reset());
  }
  private reset() {
    this.generation++;
    this.abort.abort();
    this.api.disconnect();
    this.dialog.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => {
      input.value = '';
    });
  }
  invalidate() {
    if (this.dialog.open) {
      this.reset();
      this.content.replaceChildren();
      this.message.textContent =
        'The model changed. Close this window, generate it again, and start a new quote.';
    }
  }
  private save() {
    // Fail before uploads/orders if recovery information cannot be persisted.
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.receipt));
    } catch {
      throw new MarketigerError(
        'Could not save the recovery reference on this device. Check Marketiger HUB before retrying.',
        true,
      );
    }
  }
  private text(value: string) {
    const p = document.createElement('p');
    p.textContent = value;
    this.content.append(p);
    return p;
  }
  private button(label: string, action: () => Promise<void>) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = label;
    button.onclick = () => {
      void this.run(action);
    };
    this.content.append(button);
    return button;
  }
  private async run(action: () => Promise<void>) {
    if (this.working) return;
    this.working = true;
    const generation = this.generation;
    this.content.setAttribute('aria-busy', 'true');
    this.content.querySelectorAll<HTMLButtonElement>('button').forEach(b => (b.disabled = true));
    this.message.textContent = 'Working…';
    try {
      await action();
      if (generation === this.generation) this.message.textContent = '';
    } catch (error) {
      if (generation === this.generation) {
        this.message.textContent = error instanceof Error ? error.message : String(error);
        if (error instanceof MarketigerError && error.uncertain) this.content.replaceChildren();
      }
    } finally {
      this.working = false;
      if (generation === this.generation) {
        this.content.removeAttribute('aria-busy');
        this.content
          .querySelectorAll<HTMLButtonElement>('button')
          .forEach(b => (b.disabled = false));
      }
    }
  }
  private current() {
    this.abort.signal.throwIfAborted();
  }
  async open() {
    if (this.dialog.open || this.working) return;
    this.reset();
    this.abort = new AbortController();
    this.model = undefined;
    this.output = undefined;
    this.dialog.innerHTML = `<header><h2>Order a full-color print</h2><button class="btn" aria-label="Close print order">Close</button></header><p>Printed and fulfilled by Marketiger. Your model and shipping details go directly to your Marketiger account.</p><div class="print-order-content"></div><p role="status" aria-live="polite"></p><footer><a href="https://hub.marketiger3d.com" target="_blank" rel="noopener noreferrer">Open Marketiger HUB</a> · <a href="https://docs.marketiger3d.com/docs/projects/" target="_blank" rel="noopener noreferrer">Account and project setup</a></footer>`;
    this.dialog
      .querySelector('header button')!
      .addEventListener('click', () => this.dialog.close());
    this.content = this.dialog.querySelector('.print-order-content')!;
    this.message = this.dialog.querySelector('[role=status]')!;
    this.dialog.showModal();
    await this.run(async () => {
      const snapshot = this.snapshot();
      if (!snapshot) throw new Error('Generate your model before ordering.');
      const output = await new ExportClient().run(
        'marketiger',
        snapshot.asset,
        snapshot.project,
        undefined,
        this.abort.signal,
      );
      this.current();
      this.output = output;
      const digest = await crypto.subtle.digest('SHA-256', output.bytes.slice().buffer);
      this.current();
      this.fingerprint = Array.from(new Uint8Array(digest), b =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      this.receipt = readReceipt();
      this.text(
        `Model: ${output.printModel!.dimensionsMm.map(v => v.toFixed(2)).join(' × ')} mm. One full-color exterior; ${output.printModel!.volumeCm3.toFixed(2)} cm³.`,
      );
      const palette = document.createElement('div');
      palette.className = 'print-palette';
      for (const group of projectMaterialGroups(snapshot.project)) {
        const swatch = document.createElement('span');
        swatch.textContent = group.name;
        swatch.style.borderLeft = `12px solid ${group.color}`;
        palette.append(swatch);
      }
      this.content.append(palette);
      this.text(
        'Review the model in the workbench before uploading. Use a Marketiger project configured for full-color printing and Stripe Checkout. Marketiger must activate your project and API ordering permissions.',
      );
      this.loginForm();
    });
  }
  private loginForm() {
    const form = document.createElement('form');
    form.innerHTML = `<label>Marketiger email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary">Connect Marketiger</button>`;
    this.content.append(form);
    form.onsubmit = event => {
      event.preventDefault();
      if (this.working) return;
      const data = new FormData(form);
      const password = String(data.get('password'));
      (form.elements.namedItem('password') as HTMLInputElement).value = '';
      void this.run(async () => {
        await this.api.login(String(data.get('email')), password, this.abort.signal);
        this.current();
        const { projects } = await this.api.projects(this.abort.signal);
        this.current();
        this.content.replaceChildren();
        if (!projects?.length) {
          this.text(
            'Marketiger has not assigned a project to your account. Use the setup link below to request a full-color project with Stripe Checkout and API ordering enabled.',
          );
          return;
        }
        if (this.receipt?.orderId) {
          this.text('A previous order is saved on this device.');
          this.button('Check previous order', () => this.showOrder(this.receipt!.orderId!));
        }
        if (this.receipt?.pending) {
          this.text(
            `A previous ${this.receipt.pending} may have succeeded. Check HUB for ${this.receipt.filename} before starting again.`,
          );
          this.button('I checked HUB; start a new quote', async () => {
            this.receipt = undefined;
            localStorage.removeItem(storageKey);
            this.projectPicker(projects);
          });
          return;
        }
        this.projectPicker(projects);
      });
    };
  }
  private projectPicker(projects: { projectId: string; name: string }[]) {
    const label = document.createElement('label');
    label.textContent = 'Marketiger project';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Marketiger project');
    projects.forEach(project => select.add(new Option(project.name, project.projectId)));
    label.append(select);
    this.content.append(label);
    this.text('Uploading sends the colored model, not your project file or original GPX tracks.');
    this.button('Upload model and get quote', async () => {
      const projectId = select.value;
      if (
        this.receipt?.fingerprint !== this.fingerprint ||
        this.receipt.projectId !== projectId ||
        !this.receipt.modelId ||
        this.receipt.orderId
      ) {
        this.receipt = {
          fingerprint: this.fingerprint,
          projectId,
          filename: `contour-${crypto.randomUUID()}.zip`,
          pending: 'upload',
        };
        this.save();
        const data = new FormData();
        data.set('projectId', projectId);
        data.set(
          'model3D',
          new Blob([this.output!.bytes.slice().buffer], { type: 'application/zip' }),
          this.receipt.filename,
        );
        data.set(
          'estimatedBounds',
          this.output!.printModel!.dimensionsMm.map((v, i) => `${['x', 'y', 'z'][i]}:${v}`).join(
            ' ',
          ),
        );
        data.set('estimatedVolume', String(this.output!.printModel!.volumeCm3));
        try {
          const result = await this.api.request<{ modelId: string }>(
            '/Model3D/UploadModelFile',
            data,
            this.abort.signal,
          );
          if (typeof result.modelId !== 'string' || !result.modelId.trim())
            throw new MarketigerError('Missing upload reference. Check HUB before retrying.', true);
          this.receipt.modelId = result.modelId;
          this.receipt.pending = undefined;
          this.save();
          this.current();
        } catch (error) {
          if (!(error instanceof MarketigerError && error.uncertain)) {
            this.receipt.pending = undefined;
            this.save();
          }
          throw error;
        }
      }
      this.content.replaceChildren();
      this.text('Model uploaded. Processing can take several minutes.');
      this.button('Check processing and quote', () => this.checkModel());
      await this.checkModel();
    });
  }
  private async checkModel() {
    const result = await this.api.model(this.receipt!.modelId!, this.abort.signal);
    this.current();
    if (!result.modelReady || result.model.status !== 3) {
      this.text(
        'Marketiger is still preparing this model. Check again shortly; if it remains unavailable, inspect it in HUB.',
      );
      return;
    }
    validatePrintQuote(result.model, this.output!.printModel!.dimensionsMm);
    this.model = result.model;
    this.content.replaceChildren();
    this.text(
      `Marketiger quote: ${euros(this.model.price!)} per model, excluding VAT and shipping. Dimensions: ${this.model.bounds}.`,
    );
    if (this.model.image?.startsWith('https://')) {
      const image = document.createElement('img');
      image.onload = () => {
        if (image.isConnected && this.dialog.open && !this.abort.signal.aborted)
          this.shippingForm();
      };
      image.onerror = () => {
        if (!image.isConnected || !this.dialog.open || this.abort.signal.aborted) return;
        this.text('The processed preview could not be loaded. Refresh it before ordering.');
        this.button('Refresh preview', () => this.checkModel());
      };
      image.alt = 'Marketiger processed model preview';
      image.referrerPolicy = 'no-referrer';
      image.src = this.model.image;
      this.content.append(image);
    } else {
      this.text('No processed preview is available yet. Check again before ordering.');
      this.button('Refresh preview', () => this.checkModel());
      return;
    }
  }
  private shippingForm() {
    const form = document.createElement('form');
    form.innerHTML = `<label>Quantity<input name="quantity" type="number" min="1" max="100" step="1" value="1" required></label><label>Country code (for example US)<input name="country" pattern="[A-Za-z]{2}" maxlength="2" value="US" required></label><button class="btn">Get shipping options</button><div class="print-shipping"></div>`;
    this.content.append(form);
    const shipping = form.querySelector<HTMLElement>('.print-shipping')!;
    let methods: ShippingMethod[] = [];
    form.addEventListener('input', event => {
      const name = (event.target as HTMLInputElement).name;
      if (name === 'country' || name === 'quantity') {
        methods = [];
        shipping.replaceChildren();
      }
    });
    form.onsubmit = event => {
      event.preventDefault();
      if (this.working) return;
      const data = new FormData(form);
      const country = String(data.get('country')).toUpperCase();
      const quantity = Number(data.get('quantity'));
      void this.run(async () => {
        const response = await this.api.request<{ methods: ShippingMethod[] }>(
          '/Shipping/GetShippingMethods',
          { country, models: [{ modelId: this.receipt!.modelId, quantity }] },
          this.abort.signal,
        );
        this.current();
        const current = new FormData(form);
        if (
          String(current.get('country')).toUpperCase() !== country ||
          Number(current.get('quantity')) !== quantity
        )
          return;
        methods = response.methods.filter(
          m =>
            !m.servicePoint &&
            Number.isInteger(m.shippingMethodId) &&
            Number.isInteger(m.price) &&
            m.price >= 0,
        );
        shipping.replaceChildren();
        if (!methods.length) {
          shipping.textContent =
            'No supported delivery options for this destination. Contact Marketiger.';
          return;
        }
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Shipping method');
        methods.forEach(m =>
          select.add(
            new Option(
              `${m.carrier} ${m.method}: ${euros(m.price)} excluding VAT`,
              String(m.shippingMethodId),
            ),
          ),
        );
        shipping.append(select);
        const subtotal = document.createElement('p');
        shipping.append(subtotal);
        const showTotal = () => {
          subtotal.textContent = `Subtotal: ${euros(this.model!.price! * quantity + methods.find(m => m.shippingMethodId === Number(select.value))!.price)} excluding VAT. Final total is confirmed by Marketiger.`;
        };
        showTotal();
        select.onchange = showTotal;
        for (const [name, title] of [
          ['firstName', 'First name'],
          ['lastName', 'Last name'],
          ['streetAddress', 'Street address'],
          ['city', 'City'],
          ['countryState', 'State / region (optional)'],
          ['postal', 'Postal code'],
          ['phoneNumber', 'Phone number'],
          ['email', 'Email'],
        ]) {
          const label = document.createElement('label');
          label.textContent = title;
          const input = document.createElement('input');
          input.name = name;
          input.required = name !== 'countryState';
          input.type = name === 'email' ? 'email' : 'text';
          label.append(input);
          shipping.append(label);
        }
        const confirm = document.createElement('label');
        confirm.className = 'print-confirm';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.required = true;
        confirm.append(
          checkbox,
          'I reviewed the processed model and colors. I authorize this order and confirm my project uses Stripe Checkout.',
        );
        shipping.append(confirm);
        const checkout = document.createElement('button');
        checkout.type = 'button';
        checkout.className = 'btn primary';
        checkout.textContent = 'Create order with Marketiger';
        shipping.append(checkout);
        checkout.onclick = () => {
          if (!form.reportValidity() || !checkbox.checked || this.working) return;
          void this.run(async () => {
            const address = Object.fromEntries(new FormData(form));
            delete address.quantity;
            this.receipt!.pending = 'order';
            this.save();
            try {
              const result = await this.api.request<{ orderId: string; paymentUrl?: string }>(
                '/Order/CreateOrder',
                {
                  ...address,
                  country,
                  models: [{ modelId: this.receipt!.modelId, quantity }],
                  shippingMethod: Number(select.value),
                },
                this.abort.signal,
              );
              if (typeof result.orderId !== 'string' || !result.orderId.trim())
                throw new MarketigerError(
                  'Missing order reference. Check HUB before retrying.',
                  true,
                );
              this.receipt!.orderId = result.orderId;
              this.receipt!.pending = undefined;
              this.save();
              this.current();
              this.content.replaceChildren();
              this.text('Order created. Payment and fulfillment are handled by Marketiger.');
              this.showPayment(result.paymentUrl);
              this.button('Refresh order status', () => this.showOrder(result.orderId));
            } catch (error) {
              if (!(error instanceof MarketigerError && error.uncertain)) {
                this.receipt!.pending = undefined;
                this.save();
              }
              throw error;
            }
          });
        };
      });
    };
  }
  private showPayment(url?: string) {
    const safe = paymentLink(url);
    if (!safe) {
      this.text(
        'No supported payment link was returned. Open HUB to check this existing order and contact Marketiger. Do not create a duplicate order.',
      );
      return;
    }
    const link = document.createElement('a');
    link.href = safe;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'btn primary';
    link.textContent = 'Pay securely with Marketiger';
    this.content.append(link);
  }
  private async showOrder(id: string) {
    const { order } = await this.api.order(id, this.abort.signal);
    this.current();
    this.content.replaceChildren();
    this.text(`Order ${order.id}: ${orderStatus(order.status)}.`);
    if ([1, 3, 4].includes(order.status)) this.showPayment(order.paymentLink);
    this.button('Refresh order status', () => this.showOrder(id));
  }
}

/** Direct customer-account API access. Credentials never enter persistent storage. */
export const marketigerBase = 'https://api.marketiger3d.com/v2';
export class MarketigerError extends Error {
  constructor(
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export interface PrintModel {
  id: string;
  status: number;
  bounds: string | null;
  price: number | null;
  parts: number | null;
  image: string | null;
}
export interface ShippingMethod {
  shippingMethodId: number;
  carrier: string;
  method: string;
  servicePoint: boolean;
  price: number;
}
export interface PrintOrder {
  id: string;
  status: number;
  paymentLink?: string;
}
export const euros = (cents: number) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(cents / 100);
/** Reject provider scale changes, incomplete processing, and missing prices. */
export function validatePrintQuote(model: PrintModel, dimensionsMm: number[]) {
  const bounds = /^\s*x:\s*([\d.e+-]+)\s+y:\s*([\d.e+-]+)\s+z:\s*([\d.e+-]+)\s*$/i.exec(
    model.bounds || '',
  );
  if (
    model.status !== 3 ||
    !bounds ||
    dimensionsMm.length !== 3 ||
    dimensionsMm.some(
      (expected, i) =>
        !Number.isFinite(expected) ||
        expected <= 0 ||
        !Number.isFinite(Number(bounds[i + 1])) ||
        Math.abs(Number(bounds[i + 1]) - expected) > Math.max(0.1, expected * 0.005),
    )
  )
    throw new Error(
      'Processed dimensions do not match this model. Ordering is blocked; contact Marketiger.',
    );
  if (model.parts !== 1)
    throw new Error('Marketiger must report one connected part before ordering.');
  if (!Number.isInteger(model.price) || model.price! < 0)
    throw new Error('Marketiger has not returned a valid price.');
}
export function paymentLink(url: string | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'checkout.stripe.com')
      return parsed.href;
  } catch {
    /* Invalid URL. */
  }
}
export function orderStatus(status: number) {
  return (
    (
      {
        0: 'Canceled or expired',
        1: 'Created, unpaid',
        2: 'On hold',
        3: 'Unpaid',
        4: 'Payment pending',
        5: 'Paid',
        10: 'Shipped',
        15: 'On hold',
      } as Record<number, string>
    )[status] || `Provider status ${status}`
  );
}
export class MarketigerClient {
  private token = '';
  disconnect() {
    this.token = '';
  }
  async request<T>(path: string, body?: object | FormData, signal?: AbortSignal): Promise<T> {
    const mutating = path === '/Model3D/UploadModelFile' || path === '/Order/CreateOrder';
    let response: Response;
    try {
      response = await fetch(marketigerBase + path, {
        method: body ? 'POST' : 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
    } catch {
      throw new MarketigerError(
        mutating
          ? 'The response was interrupted. The provider may have accepted this request. Check Marketiger HUB before retrying.'
          : 'Could not reach Marketiger. Check your connection and try again.',
        mutating,
      );
    }
    if (response.status === 401) {
      this.disconnect();
      throw new Error('Your Marketiger session expired. Close and reconnect.');
    }
    let payload;
    try {
      payload = await response.json();
      if (typeof payload === 'string') payload = JSON.parse(payload);
    } catch {
      throw new MarketigerError(
        'Marketiger returned an unreadable response. Check HUB before retrying.',
        mutating,
      );
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.success !== 'boolean' ||
      (payload.success && (!payload.data || typeof payload.data !== 'object'))
    )
      throw new MarketigerError(
        'Marketiger returned an incomplete response. Check HUB before retrying.',
        mutating,
      );
    if (!response.ok || !payload.success)
      throw new MarketigerError(
        payload.error?.message || `Marketiger request failed (${response.status}).`,
        mutating && response.status >= 500,
      );
    return payload.data as T;
  }
  async login(email: string, password: string, signal: AbortSignal) {
    const data = await this.request<{ accessToken: string }>(
      '/Auth/Login',
      { email, password },
      signal,
    );
    if (!data.accessToken) throw new Error('Marketiger did not return a session.');
    signal.throwIfAborted();
    this.token = data.accessToken;
  }
  projects(signal: AbortSignal) {
    return this.request<{ projects: { projectId: string; name: string }[] }>(
      '/Project/GetProjects',
      undefined,
      signal,
    );
  }
  model(id: string, signal: AbortSignal) {
    return this.request<{ modelReady: boolean; model: PrintModel }>(
      '/Model3D/GetModelData?modelId=' + encodeURIComponent(id),
      undefined,
      signal,
    );
  }
  order(id: string, signal: AbortSignal) {
    return this.request<{ order: PrintOrder }>(
      '/Order/GetOrder?orderId=' + encodeURIComponent(id),
      undefined,
      signal,
    );
  }
}

import { afterEach, expect, it, vi } from 'vitest';
import {
  MarketigerClient,
  MarketigerError,
  paymentLink,
  validatePrintQuote,
  orderStatus,
} from '../src/marketiger-api';
afterEach(() => vi.unstubAllGlobals());
const model = {
  id: 'model',
  status: 3,
  bounds: 'x:20 y:30 z:4',
  price: 2300,
  parts: 1,
  image: null,
};
it('blocks incomplete, rescaled, disconnected or unpriced models', () => {
  expect(() => validatePrintQuote(model, [20, 30, 4])).not.toThrow();
  for (const patch of [
    { status: 2 },
    { bounds: 'x:200 y:300 z:40' },
    { bounds: 'x:NaN y:30 z:4' },
    { price: null },
    { parts: 2 },
  ])
    expect(() => validatePrintQuote({ ...model, ...patch }, [20, 30, 4])).toThrow();
});
it('allows only hosted Stripe payment links and distinguishes unpaid status', () => {
  expect(paymentLink('https://checkout.stripe.com/pay/test')).toContain('/pay/test');
  for (const url of [
    'javascript:alert(1)',
    'https://checkout.stripe.com.evil.test',
    'http://checkout.stripe.com',
  ])
    expect(paymentLink(url)).toBeUndefined();
  expect(orderStatus(1)).toBe('Created, unpaid');
  expect(orderStatus(5)).toBe('Paid');
});
it('uses customer bearer authorization without cookies and handles double encoded JSON', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ success: true, data: { accessToken: 'customer-token' } }),
    )
    .mockResolvedValueOnce(
      Response.json(JSON.stringify({ success: true, data: { projects: [] } })),
    );
  vi.stubGlobal('fetch', fetcher);
  const api = new MarketigerClient();
  const signal = new AbortController().signal;
  await api.login('customer@example.com', 'password', signal);
  await api.projects(signal);
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer customer-token');
  expect(fetcher.mock.calls[1][1].credentials).toBe('omit');
  api.disconnect();
});
it('does not retry an ambiguous order or upload', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetcher);
  const api = new MarketigerClient();
  await expect(api.request('/Order/CreateOrder', { models: [] })).rejects.toMatchObject({
    uncertain: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(api.request('/Model3D/UploadModelFile', new FormData())).rejects.toBeInstanceOf(
    MarketigerError,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('treats malformed success bodies as ambiguous after mutations', async () => {
  for (const body of [null, {}, { success: true, data: null }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(new MarketigerClient().request('/Order/CreateOrder', {})).rejects.toMatchObject({
      uncertain: true,
    });
  }
});

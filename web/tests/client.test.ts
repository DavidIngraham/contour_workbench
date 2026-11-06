import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/client';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  messages: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

describe('worker client cancellation', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('retains annotation feedback and ignores diagnostics from canceled requests', async () => {
    const engine = new Engine();
    const controller = new AbortController();
    const canceledCall = engine.call('classify', {}, undefined, controller.signal);
    controller.abort();
    await expect(canceledCall).rejects.toMatchObject({ name: 'AbortError' });
    const pending = engine.call('classify', {});
    const diagnostic = { annotationId: 'label', meshes: [], message: 'Too narrow' };
    FakeWorker.instances[0].onmessage?.({
      data: { id: 1, error: 'stale', annotationDiagnostic: diagnostic },
    } as MessageEvent);
    FakeWorker.instances[0].onmessage?.({
      data: { id: 2, error: diagnostic.message, annotationDiagnostic: diagnostic },
    } as MessageEvent);
    await expect(pending).rejects.toMatchObject({
      message: 'Too narrow',
      annotationDiagnostic: diagnostic,
    });
  });

  it('rejects other pending calls if cancellation has to restart the worker', async () => {
    const engine = new Engine();
    const controller = new AbortController();
    const canceledCall = engine.call('classify', {}, undefined, controller.signal);
    const interruptedCall = engine.call('classify', {});

    controller.abort();
    await expect(canceledCall).rejects.toMatchObject({ name: 'AbortError' });

    const interruptedExpectation = expect(interruptedCall).rejects.toThrow('worker restarted');
    await vi.advanceTimersByTimeAsync(751);
    await interruptedExpectation;
    expect(FakeWorker.instances[0].terminated).toBe(true);

    const recoveredCall = engine.call('classify', {});
    const recoveredWorker = FakeWorker.instances[1];
    recoveredWorker.onmessage?.({
      data: { id: 3, result: [] },
    } as MessageEvent);
    await expect(recoveredCall).resolves.toEqual([]);
  });
});

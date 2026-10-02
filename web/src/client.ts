/** Typed request/response client for the geometry web worker. */
import type {
  EngineOperation,
  EngineOperationMap,
  EngineProgress,
  EngineRequest,
  EngineResponse,
} from './engine-contract';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  progress?: (progress: EngineProgress) => void;
  removeAbortListener?: () => void;
}

const canceled = () => new DOMException('Operation canceled', 'AbortError');

/** Lazily starts the geometry worker and owns in-flight request cancellation. */
export class Engine {
  private worker?: Worker;
  private next = 1;
  private pending = new Map<number, PendingRequest>();
  private canceling = new Set<number>();
  private terminationTimer?: ReturnType<typeof setTimeout>;

  private ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.listen();
  }

  private listen() {
    this.worker!.onmessage = (event: MessageEvent<EngineResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if ('progress' in message) {
        pending?.progress?.(message.progress);
        return;
      }
      this.canceling.delete(message.id);
      if (!this.canceling.size) clearTimeout(this.terminationTimer);
      if (!pending) return;
      pending.removeAbortListener?.();
      this.pending.delete(message.id);
      if ('error' in message) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    };
    this.worker!.onerror = event => {
      this.rejectPending(new Error(event.message));
      this.worker = undefined;
    };
  }

  /** Run a typed worker operation, optionally reporting progress and honoring an abort signal. */
  call<K extends EngineOperation>(
    type: K,
    payload: EngineOperationMap[K]['payload'],
    progress?: (progress: EngineProgress) => void,
    signal?: AbortSignal,
  ): Promise<EngineOperationMap[K]['result']> {
    if (signal?.aborted) return Promise.reject(canceled());
    this.ensure();
    const id = this.next++;
    const request: EngineRequest = { id, type, payload } as EngineRequest;
    return new Promise((resolve, reject) => {
      const abort = () => this.cancelRequest(id, canceled());
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: value => resolve(value as EngineOperationMap[K]['result']),
        reject,
        progress,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      this.worker!.postMessage(request);
    });
  }

  /** Request cooperative cancellation, preserving cached worker state when it responds promptly. */
  cancel() {
    for (const id of [...this.pending.keys()]) this.cancelRequest(id, canceled());
  }

  private cancelRequest(id: number, error: Error) {
    const pending = this.pending.get(id);
    if (!pending || !this.worker) return;
    pending.removeAbortListener?.();
    pending.reject(error);
    this.pending.delete(id);
    this.canceling.add(id);
    this.worker.postMessage({ cancel: id });
    clearTimeout(this.terminationTimer);
    this.terminationTimer = setTimeout(() => {
      if (!this.canceling.size) return;
      this.worker?.terminate();
      this.worker = undefined;
      this.canceling.clear();
      this.rejectPending(new Error('Geometry worker restarted after cancellation.'));
    }, 750);
  }

  private rejectPending(error: Error) {
    clearTimeout(this.terminationTimer);
    for (const pending of this.pending.values()) {
      pending.removeAbortListener?.();
      pending.reject(error);
    }
    this.pending.clear();
    this.canceling.clear();
  }
}

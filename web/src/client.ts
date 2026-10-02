/** Typed request/response client for the geometry web worker. */
export class Engine {
  private worker?: Worker;
  private next = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (s: string) => void }
  >();
  private ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.listen();
  }
  private listen() {
    this.worker!.onmessage = e => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress) {
        p.progress?.(e.data.progress);
        return;
      }
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    this.worker!.onerror = e => {
      for (const p of this.pending.values()) p.reject(new Error(e.message));
      this.pending.clear();
    };
  }
  call<T = any>(type: string, payload: unknown, progress?: (s: string) => void): Promise<T> {
    this.ensure();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker!.postMessage({ id, type, payload });
    });
  }
  cancel() {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) p.reject(new Error('Operation canceled'));
    this.pending.clear();
  }
}

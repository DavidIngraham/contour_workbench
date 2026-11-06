import type { Mesh } from './types';
/** Serializable, model-space feedback for components rejected by insert generation. */
export interface AnnotationDiagnostic {
  annotationId: string;
  meshes: Mesh[];
  message: string;
}
/** Carries detached mesh copies across worker failures without retaining WASM objects. */
export class AnnotationPrintError extends Error {
  constructor(public readonly annotationDiagnostic: AnnotationDiagnostic) {
    super(annotationDiagnostic.message);
    this.name = 'AnnotationPrintError';
  }
}

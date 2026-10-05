import { describe, expect, it } from 'vitest';
import { userErrorMessage } from '../src/user-errors';

describe('user-facing errors', () => {
  it('hides internal packet details', () => {
    expect(userErrorMessage(new Error('Final terrain metadata is inconsistent.'))).toBe(
      'Something went wrong while building the model. Your design is unchanged—try again.',
    );
  });

  it('offers an action when geometry cannot be combined', () => {
    expect(
      userErrorMessage(new Error('Terrain operation did not produce a valid solid')),
    ).toContain('Try disabling');
  });

  it('preserves useful validation messages', () => {
    expect(userErrorMessage(new Error('Draw at least three vertices.'))).toBe(
      'Draw at least three vertices.',
    );
  });

  it('names a label without exposing solid-model terminology', () => {
    expect(userErrorMessage(new Error('Annotation Summit could not form a solid.'))).toBe(
      'The “Summit” label cannot be added here. Move it or make it larger.',
    );
  });
});

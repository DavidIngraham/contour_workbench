import { describe, expect, it } from 'vitest';
import jsonManifest from '../src/serialized-contract.json';
import { serializedContract } from '../src/serialized-contract';
import { defaults } from '../src/types';

describe('serialized Rust/TypeScript contract', () => {
  it('keeps the checked JSON manifest synchronized with TypeScript', () => {
    expect(serializedContract).toEqual(jsonManifest);
  });

  it('lists every serialized Settings field', () => {
    expect([...serializedContract.fields.Settings].sort()).toEqual(Object.keys(defaults).sort());
  });
});

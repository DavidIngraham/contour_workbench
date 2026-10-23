import { describe, expect, it } from 'vitest';
import jsonManifest from '../src/serialized-contract.json';
import { serializedContract } from '../src/serialized-contract';
import {
  defaults,
  defaultClassPriority,
  normalizeSettings,
  normalizeClassPriority,
} from '../src/types';

describe('serialized Rust/TypeScript contract', () => {
  it('keeps the checked JSON manifest synchronized with TypeScript', () => {
    expect(serializedContract).toEqual(jsonManifest);
  });

  it('lists every serialized Settings field', () => {
    expect([...serializedContract.fields.Settings].sort()).toEqual(Object.keys(defaults).sort());
  });
  it('migrates class priority without sharing mutable defaults and preserves saved orders', () => {
    const old = normalizeSettings({});
    expect(old.class_priority).toEqual(defaultClassPriority);
    old.class_priority.reverse();
    expect(defaults.class_priority).toEqual(defaultClassPriority);
    const partial = normalizeClassPriority(['road', 'road', 'unknown', 'water']);
    expect(partial).toEqual(['road', 'water', 'glacier', 'ski_run', 'trail', 'stream', 'ski_lift']);
    expect(
      normalizeSettings(JSON.parse(JSON.stringify({ class_priority: partial }))).class_priority,
    ).toEqual(partial);
  });
});

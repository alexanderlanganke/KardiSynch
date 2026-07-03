import { describe, it, expect } from 'vitest';
import { nameDistance, normalizeNameKey } from '../lib/names';

describe('nameDistance', () => {
  it('is 0 for identical names (after normalization)', () => {
    expect(nameDistance('Smith', 'smith')).toBe(0);
    expect(nameDistance('  Müller ', 'müller')).toBe(0);
  });

  it('counts single-character edits', () => {
    expect(nameDistance('Smith', 'Smyth')).toBe(1);      // substitution
    expect(nameDistance('Johnson', 'Johnsen')).toBe(1);  // substitution
    expect(nameDistance('Meyer', 'Meyers')).toBe(1);     // insertion
    expect(nameDistance('Clarke', 'Clark')).toBe(1);     // deletion
  });

  it('grows with more differences', () => {
    expect(nameDistance('Smith', 'Jones')).toBeGreaterThan(2);
  });

  it('handles empty / nullish input', () => {
    expect(nameDistance('', '')).toBe(0);
    expect(nameDistance(null, undefined)).toBe(0);
    expect(nameDistance('Smith', null)).toBe(normalizeNameKey('Smith').length);
  });
});

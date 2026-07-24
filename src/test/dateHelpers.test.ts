import { describe, it, expect } from 'vitest';
import { formatTime, dateKey } from '../lib/utils';

describe('formatTime', () => {
  it('extracts HH:MM from a full ISO timestamp', () => {
    expect(formatTime('2023-06-15T14:32:07')).toBe('14:32');
    expect(formatTime('2023-06-15T09:05:00Z')).toBe('09:05');
  });

  it('returns null for a date-only value (no time component)', () => {
    expect(formatTime('2023-06-15')).toBeNull();
  });

  it('returns null for empty/undefined input', () => {
    expect(formatTime('')).toBeNull();
    expect(formatTime(undefined)).toBeNull();
    expect(formatTime(null)).toBeNull();
  });
});

describe('dateKey', () => {
  it('strips the time component, leaving just the calendar date', () => {
    expect(dateKey('2023-06-15T14:32:07')).toBe('2023-06-15');
  });

  it('passes a date-only value through unchanged', () => {
    expect(dateKey('2023-06-15')).toBe('2023-06-15');
  });

  it('returns an empty string for empty/undefined input', () => {
    expect(dateKey('')).toBe('');
    expect(dateKey(undefined)).toBe('');
    expect(dateKey(null)).toBe('');
  });
});

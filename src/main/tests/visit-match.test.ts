import { describe, it, expect } from 'vitest';
import { pickSameDayReport } from '../services/visitMatch';

const visit = (over: Partial<{ id: string; interrogation_date: string; device_serial_number: string | null }> = {}) => ({
  id: 'existing-1',
  interrogation_date: '2026-07-21T09:30:00',
  device_serial_number: 'ABC123',
  ...over,
});

describe('pickSameDayReport', () => {
  describe('auto / non-explicit mode', () => {
    it('reuses a same-day visit when nothing contradicts it (the #140 dedup)', () => {
      const candidates = [visit()];
      const parsed = { interrogation_date: '2026-07-21', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, false)).toBe(candidates[0]);
    });

    it('reuses when the incoming file is unparseable', () => {
      const candidates = [visit()];
      expect(pickSameDayReport(candidates, null, false)).toBe(candidates[0]);
    });

    it('does not reuse a visit from a different device (dedupService serial invariant)', () => {
      const candidates = [visit({ device_serial_number: 'OTHER999' })];
      const parsed = { interrogation_date: '2026-07-21', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, false)).toBeNull();
    });

    it('does not merge two same-day interrogations hours apart (issue #145, pre/post MRI)', () => {
      const preMri = visit({ interrogation_date: '2026-07-21T09:30:00' });
      const parsedPostMri = { interrogation_date: '2026-07-21T14:05:00', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport([preMri], parsedPostMri, false)).toBeNull();
    });

    it('treats timestamps a few minutes apart as the same session (XML vs printed PDF)', () => {
      const candidates = [visit({ interrogation_date: '2026-07-21T09:30:00' })];
      const parsed = { interrogation_date: '2026-07-21T09:34:12', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, false)).toBe(candidates[0]);
    });

    it('picks the compatible candidate among several same-day visits', () => {
      const preMri = visit({ id: 'pre', interrogation_date: '2026-07-21T09:30:00' });
      const postMri = visit({ id: 'post', interrogation_date: '2026-07-21T14:00:00' });
      const parsed = { interrogation_date: '2026-07-21T14:02:00', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport([preMri, postMri], parsed, false)).toBe(postMri);
    });

    it('matches when serials are missing on either side', () => {
      const candidates = [visit({ device_serial_number: null })];
      const parsed = { interrogation_date: '2026-07-21' };
      expect(pickSameDayReport(candidates, parsed, false)).toBe(candidates[0]);
    });
  });

  describe('explicit "Create New Visit" mode', () => {
    it('honors the choice for a date-only file even when a same-day visit exists (issue #145)', () => {
      const candidates = [visit()];
      const parsed = { interrogation_date: '2026-07-21', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, true)).toBeNull();
    });

    it('honors the choice when the file is unparseable', () => {
      expect(pickSameDayReport([visit()], null, true)).toBeNull();
    });

    it('still dedups a provably identical interrogation (the #140 auto-import race)', () => {
      const candidates = [visit({ interrogation_date: '2026-07-21T09:30:00' })];
      const parsed = { interrogation_date: '2026-07-21T09:30:00', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, true)).toBe(candidates[0]);
    });

    it('does not dedup a same-day interrogation hours later', () => {
      const candidates = [visit({ interrogation_date: '2026-07-21T09:30:00' })];
      const parsed = { interrogation_date: '2026-07-21T14:05:00', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, true)).toBeNull();
    });

    it('does not dedup across different device serials even at the same time', () => {
      const candidates = [visit({ device_serial_number: 'OTHER999' })];
      const parsed = { interrogation_date: '2026-07-21T09:30:00', device: { serial_number: 'ABC123' } };
      expect(pickSameDayReport(candidates, parsed, true)).toBeNull();
    });
  });

  it('returns null for no candidates', () => {
    expect(pickSameDayReport([], { interrogation_date: '2026-07-21' }, false)).toBeNull();
  });
});

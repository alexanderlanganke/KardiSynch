import {
  getPatientsWithSerials,
  getReportIdsForPatient,
  getPatientById,
  deletePatient,
  PatientWithSerials,
} from '../database';
import { normalizeNameKey, nameDistance } from '../../lib/names';

/**
 * Confidence tiers for flagging two patient records as the same person,
 * ordered strongest → weakest. See findDuplicatePatientGroups.
 */
export type DupTier = 'exact' | 'serial' | 'dob-fuzzy-name' | 'name-close-dob' | 'name-only';

const TIER_ORDER: DupTier[] = ['exact', 'serial', 'dob-fuzzy-name', 'name-close-dob', 'name-only'];

const TIER_LABELS: Record<DupTier, string> = {
  'exact': 'Same name and date of birth',
  'serial': 'Shared device serial number',
  'dob-fuzzy-name': 'Same date of birth, similar last name',
  'name-close-dob': 'Same last name, near-identical date of birth',
  'name-only': 'Same last name',
};

export interface PatientSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  hospitalPatientId: string | null;
  reportCount: number;
  lastReportDate: string | null;
  serials: string[];
}

export interface PatientDupGroup {
  /** Highest-confidence tier that produced this group. */
  tier: DupTier;
  /** Human-readable reason, e.g. "Shared device serial number (12345)". */
  reason: string;
  patients: PatientSummary[];
}

export interface MergeResult {
  keeperId: string;
  patientsDeleted: number;
  reportsMoved: number;
  errors: string[];
}

const LAST_NAME_FUZZY_MAX_DISTANCE = 2;
const DOB_CLOSE_MAX_DAYS = 3;

const toSummary = (p: PatientWithSerials): PatientSummary => ({
  id: p.id,
  first_name: p.first_name,
  last_name: p.last_name,
  dob: p.dob,
  hospitalPatientId: p.hospitalPatientId,
  reportCount: p.reportCount,
  lastReportDate: p.lastReportDate,
  serials: p.serials,
});

/** Whole-day difference between two YYYY-MM-DD dates, or null if unparseable. */
function dobDayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / (1000 * 60 * 60 * 24);
}

/**
 * A minimal union-find over patient IDs. Duplicate detection produces pairwise
 * links; we union them so transitively-related patients (A~B, B~C) end up in one
 * group rather than three overlapping pairs.
 */
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Detect duplicate / probable-duplicate patient records across five confidence
 * tiers. Each unordered patient pair is scored by the STRONGEST tier that links
 * them; connected pairs are unioned into groups. Groups are returned sorted by
 * tier strength. The weak `name-only` tier can produce large groups (everyone
 * sharing a surname) — the UI presents these collapsed and un-selected.
 */
export async function findDuplicatePatientGroups(): Promise<PatientDupGroup[]> {
  const patients = await getPatientsWithSerials();

  // Pairwise strongest link. Keyed by "idA|idB" (sorted) → tier.
  const pairTier = new Map<string, DupTier>();
  const pairReason = new Map<string, string>();

  const rank = (t: DupTier) => TIER_ORDER.indexOf(t);
  const link = (a: string, b: string, tier: DupTier, reason: string) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = pairTier.get(key);
    if (existing === undefined || rank(tier) < rank(existing)) {
      pairTier.set(key, tier);
      pairReason.set(key, reason);
    }
  };

  // Index serials → patient IDs for the serial tier.
  const serialIndex = new Map<string, string[]>();
  for (const p of patients) {
    for (const s of p.serials) {
      const arr = serialIndex.get(s) || [];
      arr.push(p.id);
      serialIndex.set(s, arr);
    }
  }
  for (const [serial, ids] of serialIndex) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        link(ids[i], ids[j], 'serial', `Shared device serial (${serial})`);
      }
    }
  }

  // Name/DOB based tiers — O(n^2), acceptable for local patient counts.
  const byId = new Map(patients.map(p => [p.id, p]));
  for (let i = 0; i < patients.length; i++) {
    const a = patients[i];
    const aKey = a.last_name_key || normalizeNameKey(a.last_name);
    for (let j = i + 1; j < patients.length; j++) {
      const b = patients[j];
      const bKey = b.last_name_key || normalizeNameKey(b.last_name);
      if (!aKey && !bKey) continue;

      const sameName = aKey && bKey && aKey === bKey;
      const sameDob = a.dob && b.dob && a.dob === b.dob;

      if (sameName && sameDob) {
        link(a.id, b.id, 'exact', TIER_LABELS['exact']);
        continue;
      }
      if (sameDob) {
        const dist = nameDistance(a.last_name, b.last_name);
        if (dist > 0 && dist <= LAST_NAME_FUZZY_MAX_DISTANCE) {
          link(a.id, b.id, 'dob-fuzzy-name', `${TIER_LABELS['dob-fuzzy-name']} (edit distance ${dist})`);
          continue;
        }
      }
      if (sameName) {
        const dayDiff = dobDayDiff(a.dob, b.dob);
        if (dayDiff !== null && dayDiff > 0 && dayDiff <= DOB_CLOSE_MAX_DAYS) {
          link(a.id, b.id, 'name-close-dob', `${TIER_LABELS['name-close-dob']} (${dayDiff} day diff)`);
          continue;
        }
        // Weakest tier: same surname only.
        link(a.id, b.id, 'name-only', TIER_LABELS['name-only']);
      }
    }
  }

  // Union linked pairs into components; track the strongest tier + its reason
  // per component root.
  const uf = new UnionFind();
  for (const key of pairTier.keys()) {
    const [x, y] = key.split('|');
    uf.union(x, y);
  }

  const componentMembers = new Map<string, Set<string>>();
  const componentTier = new Map<string, DupTier>();
  const componentReason = new Map<string, string>();

  const addMember = (root: string, id: string) => {
    const set = componentMembers.get(root) || new Set<string>();
    set.add(id);
    componentMembers.set(root, set);
  };

  for (const [key, tier] of pairTier) {
    const [x, y] = key.split('|');
    const root = uf.find(x);
    addMember(root, x);
    addMember(root, y);
    const existing = componentTier.get(root);
    if (existing === undefined || rank(tier) < rank(existing)) {
      componentTier.set(root, tier);
      componentReason.set(root, pairReason.get(key)!);
    }
  }

  const groups: PatientDupGroup[] = [];
  for (const [root, members] of componentMembers) {
    if (members.size < 2) continue;
    const summaries = [...members]
      .map(id => byId.get(id))
      .filter((p): p is PatientWithSerials => !!p)
      .map(toSummary)
      // Most-complete record first — the suggested keeper.
      .sort((x, y) => y.reportCount - x.reportCount);
    groups.push({
      tier: componentTier.get(root)!,
      reason: componentReason.get(root)!,
      patients: summaries,
    });
  }

  groups.sort((a, b) => rank(a.tier) - rank(b.tier));
  return groups;
}

/**
 * Merge one or more "loser" patients into a "keeper": move every report/visit to
 * the keeper, consolidate the keeper's device/lead history, then delete the loser
 * records (DB row + directory). Same-date visit collisions that result are cleaned
 * up by the caller via the existing report deduplicator.
 */
export async function mergePatients(
  keeperId: string,
  loserIds: string[],
  onProgress?: (status: { message: string; progress: number }) => void
): Promise<MergeResult> {
  const result: MergeResult = { keeperId, patientsDeleted: 0, reportsMoved: 0, errors: [] };

  const uniqueLosers = [...new Set(loserIds)].filter(id => id && id !== keeperId);
  if (!uniqueLosers.length) {
    throw new Error('No distinct loser patients to merge into the keeper.');
  }

  const keeper = await getPatientById(keeperId).catch(() => null);
  if (!keeper) throw new Error(`Keeper patient ${keeperId} not found.`);

  const storage = await import('../storage');

  // 1. Move every loser's reports to the keeper.
  for (let i = 0; i < uniqueLosers.length; i++) {
    const loserId = uniqueLosers[i];
    const progress = Math.round(((i + 1) / uniqueLosers.length) * 60);
    onProgress?.({ message: `Moving visits from patient ${loserId} (${i + 1}/${uniqueLosers.length})`, progress });

    let reportIds: string[] = [];
    try {
      reportIds = await getReportIdsForPatient(loserId);
    } catch (e: any) {
      result.errors.push(`Failed to list reports for ${loserId}: ${e.message}`);
      continue;
    }

    for (const reportId of reportIds) {
      try {
        await storage.moveReport(reportId, loserId, keeperId);
        result.reportsMoved++;
      } catch (e: any) {
        result.errors.push(`Failed to move report ${reportId} from ${loserId}: ${e.message}`);
      }
    }
  }

  // 2. Consolidate device/lead history into the keeper (before losers are gone).
  onProgress?.({ message: 'Merging device history...', progress: 70 });
  try {
    await storage.mergePatientProfiles(keeperId, uniqueLosers);
  } catch (e: any) {
    result.errors.push(`Failed to merge device history: ${e.message}`);
  }

  // 3. Delete the loser patients (DB row + directory).
  for (let i = 0; i < uniqueLosers.length; i++) {
    const loserId = uniqueLosers[i];
    const progress = 70 + Math.round(((i + 1) / uniqueLosers.length) * 20);
    onProgress?.({ message: `Removing merged patient ${loserId}`, progress });
    try {
      await deletePatient(loserId);
      await storage.removePatientDirectory(loserId);
      result.patientsDeleted++;
    } catch (e: any) {
      result.errors.push(`Failed to delete patient ${loserId}: ${e.message}`);
    }
  }

  // 4. Collapse any same-date visit collisions created by the move, reusing the
  //    existing report deduplicator.
  onProgress?.({ message: 'Cleaning up duplicate visits...', progress: 92 });
  try {
    const { runDedupCleanup } = await import('./dedupService');
    await runDedupCleanup();
  } catch (e: any) {
    result.errors.push(`Post-merge dedup failed: ${e.message}`);
  }

  onProgress?.({ message: 'Merge complete.', progress: 100 });
  return result;
}

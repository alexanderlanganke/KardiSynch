export interface TrendPoint {
  date: string;
  value: number;
}

export function toNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isNaN(n) ? undefined : n;
}

// availableReports (from get-visit-directories) is sorted newest-first for the
// visit picker; charting needs oldest-first so time runs left to right.
export function sortChronological(reports: any[]): any[] {
  return [...reports]
    .filter(r => r?.interrogation_date)
    .sort((a, b) => String(a.interrogation_date).localeCompare(String(b.interrogation_date)));
}

// Two visits can legitimately share a calendar date (issue #155) — since the
// chart's x-axis is time-based, they'd otherwise land on the exact same pixel
// column and draw a meaningless zigzag between them. Collapsing same-date
// readings to their average keeps the trend line meaningful without silently
// preferring one arbitrary reading over the other.
export function buildTrendPoints(chronological: any[], extractor: (report: any) => unknown): TrendPoint[] {
  const byDate = new Map<string, number[]>();
  for (const r of chronological) {
    const value = toNumber(extractor(r));
    if (value === undefined) continue;
    const date = r.interrogation_date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(value);
  }
  const points: TrendPoint[] = [];
  for (const [date, values] of byDate) {
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    points.push({ date, value: average });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

// The same anatomic location can appear under different lead objects across
// visits (e.g. a lead replacement) — grouping by location keeps the trend
// meaningful even when the physical lead itself changed.
export function getLeadLocations(chronological: any[]): string[] {
  return Array.from(new Set(
    chronological.flatMap(r => (r.leads || []).map((l: any) => l.location || l.type).filter(Boolean))
  ));
}

export function buildLeadMetricPoints(
  chronological: any[],
  location: string,
  field: 'impedance' | 'sensing' | 'threshold'
): TrendPoint[] {
  return buildTrendPoints(chronological, r => {
    const lead = (r.leads || []).find((l: any) => (l.location || l.type) === location);
    return lead?.[field];
  });
}

// additional_fields are mostly one-time/baseline facts (EF, NYHA class at
// implant) rather than a re-measured trend, so when the same key appears on
// multiple visits the newest one wins rather than implying a time series.
export function mergeAdditionalFields(chronological: any[]): Record<string, { value: string; date: string }> {
  const result: Record<string, { value: string; date: string }> = {};
  for (const r of chronological) {
    if (!r.additionalFields) continue;
    for (const [key, value] of Object.entries(r.additionalFields)) {
      result[key] = { value: String(value), date: r.interrogation_date };
    }
  }
  return result;
}

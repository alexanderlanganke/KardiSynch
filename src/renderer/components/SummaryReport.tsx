import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Battery, Zap, Info, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import TrendChart, { TrendPoint } from './TrendChart';
import { sortChronological, buildTrendPoints, getLeadLocations, buildLeadMetricPoints, mergeAdditionalFields } from '@/renderer/utils/summaryData';

interface SummaryReportProps {
  availableReports: any[];
}

// Labels/units for the manufacturer-specific fields this session's parser
// work started wiring into additional_fields (see reports.ts). Any other key
// falls back to generic title-casing — additional_fields is an open bag by
// design, so this list is a display nicety, not a whitelist.
const KNOWN_ADDITIONAL_FIELD_LABELS: Record<string, string> = {
  ejection_fraction: 'Ejection Fraction (EF)',
  nyha_class: 'NYHA Class',
  indications_for_implant: 'Indications for Implant',
};

function formatFieldLabel(key: string): string {
  if (KNOWN_ADDITIONAL_FIELD_LABELS[key]) return KNOWN_ADDITIONAL_FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());
}

// A per-visit numeric field shown either as a trend chart (>= 2 real data
// points) or a plain "latest value" line (0 or 1 points) — a single implant
// reading isn't a trend and shouldn't be drawn as one.
const MetricPanel: React.FC<{ label: string; unit: string; points: TrendPoint[]; colorClass?: string }> = ({ label, unit, points, colorClass }) => {
  if (points.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {points.length >= 2 ? (
        <TrendChart points={points} unit={unit} className={colorClass} />
      ) : (
        <span className="text-sm font-medium">
          {points[0].value}{unit ? ` ${unit}` : ''}
          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">({formatDate(points[0].date)})</span>
        </span>
      )}
    </div>
  );
};

const SummaryReport: React.FC<SummaryReportProps> = ({ availableReports }) => {
  const chronological = React.useMemo(() => sortChronological(availableReports), [availableReports]);

  if (chronological.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No visits with data available for this patient yet.
      </div>
    );
  }

  const latest = chronological[chronological.length - 1];
  const voltagePoints = buildTrendPoints(chronological, r => r.batteryVoltage);
  const leadLocations = getLeadLocations(chronological);
  const additionalFields = mergeAdditionalFields(chronological);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 bg-background">
      <div>
        <h2 className="text-lg font-bold">Summary</h2>
        <p className="text-xs text-muted-foreground">
          {chronological.length} visit{chronological.length === 1 ? '' : 's'}
          {chronological.length > 1 && ` · ${formatDate(chronological[0].interrogation_date)} – ${formatDate(latest.interrogation_date)}`}
        </p>
      </div>

      {/* Device Info */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Device Information
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {latest.deviceModel && <InfoRow label="Model" value={latest.deviceModel} />}
            {latest.deviceSerial && <InfoRow label="Serial" value={latest.deviceSerial} />}
            {latest.manufacturer && <InfoRow label="Manufacturer" value={latest.manufacturer} />}
            {latest.device_type && <InfoRow label="Type" value={latest.device_type} />}
          </div>
        </CardContent>
      </Card>

      {/* Battery */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Battery className="h-4 w-4 text-green-600" /> Battery
            {latest.batteryStatus && (
              <Badge variant="outline" className="text-[10px] h-5 ml-1">{latest.batteryStatus}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricPanel label="Voltage" unit="V" points={voltagePoints} />
          {latest.batteryLongevity && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining Longevity</span>
              <span className="text-sm font-medium">
                {latest.batteryLongevity}
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(as of {formatDate(latest.interrogation_date)})</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leads */}
      {leadLocations.map(location => (
        <Card key={location}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-600" /> {location} Lead
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricPanel label="Impedance" unit="Ohm" points={buildLeadMetricPoints(chronological, location, 'impedance')} colorClass="text-primary" />
            <MetricPanel label="Sensing" unit="mV" points={buildLeadMetricPoints(chronological, location, 'sensing')} colorClass="text-amber-600" />
            <MetricPanel label="Pacing Threshold" unit="V" points={buildLeadMetricPoints(chronological, location, 'threshold')} colorClass="text-emerald-600" />
          </CardContent>
        </Card>
      ))}

      {/* Additional / non-standardized fields */}
      {Object.keys(additionalFields).length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" /> Additional Data
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <p className="text-[10px] text-muted-foreground mb-2">
              Manufacturer-specific fields with no standard slot. Usually a baseline
              fact recorded once (e.g. at implant), not a per-visit measurement.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {Object.entries(additionalFields).map(([key, { value, date }]) => (
                <InfoRow key={key} label={formatFieldLabel(key)} value={`${value} (${formatDate(date)})`} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {chronological.length < 2 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Only one visit on record — trends will appear once more visits are imported.
        </div>
      )}
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium text-foreground">{value}</span>
  </div>
);

export default SummaryReport;

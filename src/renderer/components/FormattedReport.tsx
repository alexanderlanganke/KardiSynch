import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Battery, Zap, Heart, AlertTriangle } from 'lucide-react';
import { formatDelta, formatBatteryStatus } from '@/renderer/utils/trendDelta';
import { cn } from '@/lib/utils';

interface FormattedReportProps {
  report: any;
  previousReport?: any;
}

const FormattedReport: React.FC<FormattedReportProps> = ({ report, previousReport }) => {
  if (!report) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No report data available
      </div>
    );
  }

  const batteryStatus = report.batteryStatus || report.battery_status;
  const batteryVoltage = report.batteryVoltage || report.battery_voltage;
  const isCriticalBattery = batteryStatus && (
    batteryStatus.toLowerCase().includes('eri') ||
    batteryStatus.toLowerCase().includes('eos') ||
    batteryStatus.toLowerCase().includes('eol')
  );

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Clinical Report</h2>
          <p className="text-xs text-muted-foreground">
            {report.interrogation_date && new Date(report.interrogation_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {report.manufacturer && ` - ${report.manufacturer}`}
          </p>
        </div>
        {previousReport && (
          <Badge variant="outline" className="text-[10px]">
            Comparing to {new Date(previousReport.interrogation_date).toLocaleDateString()}
          </Badge>
        )}
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
            {report.deviceModel && <InfoRow label="Model" value={report.deviceModel || report.device_model} />}
            {report.deviceSerial && <InfoRow label="Serial" value={report.deviceSerial || report.device_serial} />}
            {report.manufacturer && <InfoRow label="Manufacturer" value={report.manufacturer} />}
            {report.deviceType && <InfoRow label="Type" value={report.deviceType || report.device_type} />}
          </div>
        </CardContent>
      </Card>

      {/* Battery Status */}
      {(batteryStatus || batteryVoltage) && (
        <Card className={cn(isCriticalBattery && "border-red-500/30 bg-red-500/5")}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Battery className={cn("h-4 w-4", isCriticalBattery ? "text-red-500" : "text-green-600")} />
              Battery Status
              {isCriticalBattery && (
                <Badge className="status-urgent text-[10px] h-5 ml-2">
                  <AlertTriangle className="h-3 w-3 mr-1" /> {batteryStatus}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {batteryStatus && <InfoRow label="Status" value={batteryStatus} />}
              {batteryVoltage && <InfoRow label="Voltage" value={`${batteryVoltage}V`} />}
              {report.batteryLongevity && <InfoRow label="Longevity" value={report.batteryLongevity} />}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lead Parameters */}
      {report.leads && report.leads.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-600" /> Lead Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0 space-y-3">
            {report.leads.map((lead: any, idx: number) => {
              const prevLead = previousReport?.leads?.[idx];
              return (
                <div key={idx} className="p-2.5 bg-muted/30 rounded-md">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold">{lead.location || lead.type || `Lead ${idx + 1}`}</span>
                    {lead.model && <span className="text-[10px] text-muted-foreground">{lead.model}</span>}
                  </div>
                  <div className="space-y-0.5 text-xs font-mono">
                    {renderDelta('Impedance', lead.impedance, prevLead?.impedance, 'Ohm')}
                    {renderDelta('Threshold', lead.threshold, prevLead?.threshold, 'V')}
                    {renderDelta('Pulse Width', lead.pulseWidth || lead.pulse_width, prevLead?.pulseWidth || prevLead?.pulse_width, 'ms')}
                    {renderDelta('Sensing', lead.sensing, prevLead?.sensing, 'mV')}
                    {renderDelta('P/R Wave', lead.pWave || lead.rWave, prevLead?.pWave || prevLead?.rWave, 'mV')}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Sensing/Pacing Thresholds */}
      {report.measurements && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-500" /> Measurements
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {Object.entries(report.measurements).map(([key, value]: [string, any]) => (
                <InfoRow key={key} label={formatLabel(key)} value={String(value)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Episode Summary */}
      {report.episodes && report.episodes.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Episode Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="space-y-2">
              {report.episodes.map((episode: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs p-2 bg-muted/20 rounded">
                  <span className="font-medium">{episode.type || 'Unknown'}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {episode.count && <span>{episode.count} episodes</span>}
                    {episode.date && <span>{episode.date}</span>}
                    {episode.therapy && <Badge variant="outline" className="text-[9px] h-4">{episode.therapy}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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

function renderDelta(label: string, current: any, previous: any, unit: string): React.ReactNode {
  const delta = formatDelta(current, previous, unit, label);
  if (!delta) return null;

  const hasChange = previous !== undefined && previous !== null && current !== previous;
  const curr = typeof current === 'string' ? parseFloat(current) : current;
  const prev = typeof previous === 'string' ? parseFloat(previous) : previous;
  const isIncrease = hasChange && !isNaN(curr) && !isNaN(prev) && curr > prev;

  return (
    <div className={cn("text-muted-foreground", hasChange && "text-foreground")}>
      {delta}
    </div>
  );
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

export default FormattedReport;

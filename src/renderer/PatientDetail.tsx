import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Activity, Battery, Zap, Pencil, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import ViewPane, { SUMMARY_REPORT } from '@/components/ViewPane';
import { ErrorBoundary } from '@/renderer/components/ErrorBoundary';
import VisitTimeline from '@/components/VisitTimeline';
import DeviceLeadEditor from '@/components/DeviceLeadEditor';
import QrExportButton from '@/components/QrExportButton';
import PatientAssignmentModal from '@/components/PatientAssignmentModal';
import DataMergeModal from '@/components/DataMergeModal';
import { calculateAge } from './utils/trendDelta';
import { hasActiveWarning, daysSinceLastVisit } from './utils/clinicalPriority';
import { getMriCheckUrl } from './utils/mriCheckUrls';
import { cn, formatDate } from '@/lib/utils';
import { useAppDialog } from './components/AppDialogProvider';
import { getConnectorFlag, DeviceTypeAliasLike } from '@/lib/leadConnectorLookup';

interface PatientDetailProps {
  patientId: string;
  onBack: () => void;
}

const PatientDetail: React.FC<PatientDetailProps> = ({ patientId, onBack }) => {
  const { showAlert } = useAppDialog();
  const [patient, setPatient] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [deviceTypeAliases, setDeviceTypeAliases] = useState<DeviceTypeAliasLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedReports, setSelectedReports] = useState<(any | null)[]>([null, null]);
  const [activePaneId, setActivePaneId] = useState(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Rescan & Move State
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [scannedData, setScannedData] = useState<any>(null);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [visitToMove, setVisitToMove] = useState<any>(null);

  useEffect(() => {
    loadPatientData();
  }, [patientId]);

  const loadPatientData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const patientData = await window.electronAPI.getPatientById(patientId);
      const visitsData = await window.electronAPI.getVisitDirectories(patientId);
      // For the DF-1 / IS-1-in-LV-port highlight (#153) — a lead's role
      // (shock vs LV) only ever comes from this list, even for a lead whose
      // connector is already confirmed in patient.xml.
      window.electronAPI.listDeviceTypeAliases().then(setDeviceTypeAliases).catch(() => setDeviceTypeAliases([]));

      setPatient(patientData);
      setReports(visitsData);

      // Functional updater: loadPatientData is re-invoked after edits/moves, so
      // reading `selectedReports` from the closure would see a stale snapshot.
      // Both panes default to the Summary view (not the latest raw visit) —
      // it's the intended starting point for opening a patient.
      setSelectedReports(prev => {
        if (visitsData.length === 0) return prev;
        const next: (any | null)[] = [...prev];
        if (!next[0]) next[0] = SUMMARY_REPORT;
        if (!next[1]) next[1] = SUMMARY_REPORT;
        return next;
      });
    } catch (error) {
      console.error('Failed to load patient data:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load patient data');
    } finally {
      setLoading(false);
    }
  };

  const handlePatientUpdate = async (updatedData: any) => {
    try {
      await window.electronAPI.updatePatient(updatedData);
      await loadPatientData();
    } catch (error) {
      console.error('Failed to update patient:', error);
      showAlert(`Failed to update: ${error}`);
    }
  };

  const handleReportSelect = (paneId: number, report: any | null) => {
    // Use the functional updater so rapid drops onto different panes (or a drop
    // that races an async patient-data reload) don't clobber each other via a
    // stale `selectedReports` closure (issue #141).
    setSelectedReports(prev => {
      const newSelected = [...prev];
      newSelected[paneId] = report;
      return newSelected;
    });
  };

  const handleVisitSelect = (visit: any) => {
    const emptyPaneIndex = selectedReports.findIndex(r => r === null);
    const targetPane = emptyPaneIndex >= 0 ? emptyPaneIndex : 0;
    handleReportSelect(targetPane, visit);
  };

  const handleRescan = async (visit: any) => {
    try {
      const result = await window.electronAPI.rescanVisit(visit.id);
      if (result.status === 'success' && result.scannedData) {
        setScannedData(result.scannedData);
        setIsMergeOpen(true);
      } else {
        showAlert('Rescan completed but no usable data found to merge.');
      }
    } catch (error) {
      console.error('Rescan failed:', error);
      showAlert('Failed to rescan visit.');
    }
  };

  const handleMergeConfirm = async (mergedData: any) => {
    try {
      await handlePatientUpdate(mergedData);
      setIsMergeOpen(false);
      setScannedData(null);
    } catch (error) {
      console.error('Merge failed:', error);
    }
  };

  const handleMove = (visit: any) => {
    setVisitToMove({ ...visit, fileCount: visit.fileCount || 0 });
    setIsAssignmentOpen(true);
  };

  const handleMoveConfirm = async (decision: any) => {
    if (!visitToMove) return;
    try {
      let targetPatientId = decision.targetPatientId;
      if (decision.action === 'create-patient') {
        const newPatient = await window.electronAPI.createPatient({
          first_name: decision.patientData.first_name,
          last_name: decision.patientData.last_name,
          dob: decision.patientData.dob,
          hospitalPatientId: decision.patientData.hospitalPatientId
        });
        targetPatientId = newPatient.id;
      } else if (decision.action !== 'move-visit') {
        return;
      }
      await window.electronAPI.moveVisit(visitToMove.id, targetPatientId);
      setIsAssignmentOpen(false);
      // The visit's files now live under another patient's directory — clear it
      // from any viewer pane so a stale document isn't shown for this patient.
      const movedVisitId = visitToMove.id;
      setSelectedReports(prev => prev.map(r => (r && r.id === movedVisitId ? null : r)));
      setVisitToMove(null);
      await loadPatientData();
    } catch (error) {
      console.error('Move failed:', error);
      showAlert('Failed to move visit.');
    }
  };

  const handleExport = async (visit: any) => {
    try {
      const settings = await window.electronAPI.getSettings();
      let targetDir = settings.usbTargetDirectory;
      if (!targetDir) {
        targetDir = await window.electronAPI.selectDirectory();
      }
      if (!targetDir) return;
      const result = await window.electronAPI.exportVisitFiles(patientId, visit.id, targetDir);
      if (result.success) {
        await showAlert(`Successfully exported ${result.count} files to:\n${targetDir}`);
      } else {
        await showAlert(`Export failed: ${result.message}`);
      }
    } catch (error) {
      console.error('Export failed:', error);
      showAlert('Failed to export files.');
    }
  };

  if (loading && !patient) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading patient data...</div>
      </div>
    );
  }

  if (!patient && !loading) {
    // Distinguish a genuinely missing record from a transient load failure so
    // an IPC/disk error isn't misreported as "Patient not found".
    const isNotFound = (loadError || '').toLowerCase().includes('not found');
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4" role="alert">
        {isNotFound || !loadError ? (
          <div className="text-muted-foreground">Patient not found</div>
        ) : (
          <>
            <AlertTriangle className="h-8 w-8 text-red-500/60" />
            <div className="text-center">
              <div className="font-medium text-red-600 dark:text-red-400">Failed to load patient data</div>
              <div className="text-xs text-muted-foreground mt-1 max-w-md">{loadError}</div>
            </div>
            <Button variant="outline" onClick={() => loadPatientData()}>Retry</Button>
          </>
        )}
        <Button onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard</Button>
      </div>
    );
  }

  const age = calculateAge(patient?.dob);
  const days = daysSinceLastVisit(patient);
  const warnings = hasActiveWarning(patient);
  const deviceCount = patient?.devices?.length || 0;
  const leadCount = patient?.leads?.length || 0;

  // Build status banner items
  const bannerItems: { type: 'urgent' | 'attention'; message: string; link?: string }[] = [];
  if (warnings) {
    bannerItems.push({ type: 'urgent', message: `Active warning: ${patient?.manufacturerWarningStatus?.details || 'Check manufacturer advisory'}`, link: patient?.manufacturerWarningStatus?.link });
  }
  if (days !== null && days > 180) {
    bannerItems.push({ type: 'attention', message: `Last interrogation ${days} days ago` });
  }

  // The primary device for summaries: first non-explanted entry (several can
  // be current at once), falling back to the first entry.
  const primaryDevice = patient?.devices?.find((d: any) => d.status !== 'explanted') || patient?.devices?.[0];

  // Build device summary string for compact view
  const deviceSummary = (() => {
    const parts: string[] = [];
    if (deviceCount > 0) {
      parts.push(primaryDevice?.model || 'Unknown Device');
    }
    if (leadCount > 0) {
      parts.push(`${leadCount} lead${leadCount !== 1 ? 's' : ''}`);
    }
    return parts.length > 0 ? parts.join(' + ') : 'No device history';
  })();

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Expandable Summary Header */}
      <div className="border-b border-border bg-card shrink-0">
        {/* Top bar: Back button + Compact summary row (always visible) */}
        <div className="flex items-center h-14 px-4 mt-8 gap-0">
          {/* Back button - not part of expandable area */}
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0 hover:bg-muted rounded-full shrink-0 mr-3" aria-label="Back to dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Clickable compact summary - single dense row */}
          <div
            className="flex-1 flex items-center gap-4 min-w-0 cursor-pointer rounded-lg px-2 py-1.5 -mx-1 hover:bg-muted transition-colors group/expand"
            onClick={() => setIsExpanded(!isExpanded)}
            role="button"
            aria-expanded={isExpanded}
            aria-label="Toggle patient details"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); } }}
          >
            {/* Patient name, DOB, age */}
            <div className="flex items-baseline gap-2 shrink-0">
              <h1 className="text-sm font-bold leading-none">{patient?.name}</h1>
              <span className="text-[11px] text-muted-foreground">
                {formatDate(patient?.dob)}{age !== null ? ` (${age}y)` : ''}
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-4 bg-border/60 shrink-0" />

            {/* Device summary: "Rivacor 7 HF-T + 3 leads" */}
            <span className="text-[11px] text-foreground/70 truncate min-w-0">
              {deviceSummary}
            </span>

            {/* MRI Check Link */}
            <MriCompactBadge manufacturer={primaryDevice?.manufacturer || patient?.deviceManufacturer} />

            {/* Warning Badge */}
            {warnings && (
              <Badge className="status-urgent text-[10px] h-5 px-1.5 shrink-0">
                <AlertTriangle className="h-3 w-3 mr-1" /> Warning
              </Badge>
            )}

            {/* Separator */}
            <div className="w-px h-4 bg-border/60 shrink-0" />

            {/* Last interrogation + days ago */}
            <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
              {patient?.lastReportDate || reports[0]?.interrogation_date
                ? <span>{formatDate(patient?.lastReportDate || reports[0]?.interrogation_date)}</span>
                : <span>No visits</span>
              }
              {days !== null && (
                <span className={cn("text-[10px]", days > 180 ? "text-amber-500 font-medium" : "text-muted-foreground/60")}>
                  ({days}d)
                </span>
              )}
            </div>

            {/* Visit count */}
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-secondary shrink-0">
              {reports.length}
            </Badge>

            {/* Expand hint - chevron with subtle animation */}
            <div className={cn(
              "shrink-0 ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50 group-hover/expand:text-muted-foreground transition-colors",
            )}>
              <span className="hidden group-hover/expand:inline transition-opacity">Details</span>
              <ChevronDown className={cn(
                "h-4 w-4 transition-transform duration-200",
                isExpanded && "rotate-180"
              )} />
            </div>
          </div>
        </div>

        {/* Expanded View */}
        {isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-border animate-accordion-down">
            {/* Edit button - inside expanded area */}
            <div className="flex justify-end items-center gap-1.5 mb-3">
              {reports.length > 0 && (
                <QrExportButton
                  patient={patient}
                  report={reports[0]}
                  title="Export latest visit QR for CardioPal onboarding"
                  className="h-7 w-7"
                />
              )}
              <Button
                variant="outline" size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setIsEditorOpen(true)}
                aria-label="Edit patient and devices"
              >
                <Pencil className="h-3 w-3" /> Edit Patient & Devices
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Devices Section */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" /> Devices
                </h3>
                {patient?.devices && patient.devices.length > 0 ? (
                  <div className="space-y-2">
                    {patient.devices.map((device: any, idx: number) => (
                      <div key={`dev-${idx}`} className={`flex items-start gap-3 p-2.5 bg-muted border border-border rounded-lg text-xs ${device.status === 'explanted' ? 'opacity-60' : ''}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">{device.model || 'Unknown'}</span>
                            {device.type && <Badge variant="outline" className="text-[9px] h-4 px-1">{device.type}</Badge>}
                            {device.status === 'explanted' && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1 uppercase tracking-wide">Explanted</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                            <span>SN: {device.serial || 'Unknown'}</span>
                            {device.manufacturer && <span>{device.manufacturer}</span>}
                            {device.implant_date && <span>Implanted: {formatDate(device.implant_date)}</span>}
                          </div>
                          <div className="mt-1">
                            <MriCompactBadge manufacturer={device.manufacturer} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No devices recorded</p>
                )}
              </div>

              {/* Leads Section - SEPARATE from devices */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" /> Leads
                </h3>
                {patient?.leads && patient.leads.length > 0 ? (
                  <div className="space-y-2">
                    {patient.leads.map((lead: any, idx: number) => {
                      const flag = getConnectorFlag(lead, deviceTypeAliases);
                      return (
                      <div
                        key={`lead-${idx}`}
                        className={cn(
                          "flex items-start gap-3 p-2.5 border rounded-lg text-xs",
                          flag ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950" : "bg-muted border-border"
                        )}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{lead.model || 'Unknown'}</span>
                            {lead.location && <Badge variant="outline" className="text-[9px] h-4 px-1">{lead.location}</Badge>}
                            {lead.type && <Badge variant="outline" className="text-[9px] h-4 px-1">{lead.type}</Badge>}
                            {flag && (
                              <Badge
                                className="text-[9px] h-4 px-1.5 bg-amber-500 text-white hover:bg-amber-500 gap-1"
                                title={flag.confirmed
                                  ? `Confirmed ${flag.connector} lead — verify compatibility before a generator change.`
                                  : `Suggested ${flag.connector} based on lead model (not yet confirmed) — verify against the implant record, then confirm in Edit Patient & Devices.`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {flag.connector}{flag.connector === 'IS-1' && ' (LV)'}
                                {!flag.confirmed && '?'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                            <span>SN: {lead.serial || 'Unknown'}</span>
                            {lead.connector && lead.connector !== 'Unknown' && <span>{lead.connector}</span>}
                            {lead.implant_date && <span>Implanted: {formatDate(lead.implant_date)}</span>}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No leads recorded</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Banner */}
      {bannerItems.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-card border-b border-border space-y-1" role="alert">
          {bannerItems.map((item, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-center gap-2 text-xs px-3 py-1.5 rounded-md",
                item.type === 'urgent' ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20" : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              )}
            >
              {item.type === 'urgent' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Clock className="h-3.5 w-3.5 shrink-0" />}
              <span className="flex-1">{item.message}</span>
              {item.link && (
                <button
                  onClick={() => window.electronAPI.openExternal(item.link!)}
                  className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/20 hover:bg-red-500/30 transition-colors shrink-0"
                >
                  View Advisory <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main Content - 2 Pane Viewer */}
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-2 h-full">
          <ErrorBoundary>
            <ViewPane
              paneId={0}
              patientId={patientId}
              selectedReport={selectedReports[0]}
              availableReports={reports}
              onReportSelect={handleReportSelect}
              isActive={activePaneId === 0}
              onActivate={() => setActivePaneId(0)}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <ViewPane
              paneId={1}
              patientId={patientId}
              selectedReport={selectedReports[1]}
              availableReports={reports}
              onReportSelect={handleReportSelect}
              isActive={activePaneId === 1}
              onActivate={() => setActivePaneId(1)}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Timeline */}
      <VisitTimeline
        patient={patient}
        visits={reports.map(r => ({
          ...r,
          fileCount: r.files?.length,
        }))}
        onVisitSelect={handleVisitSelect}
        onRescan={handleRescan}
        onMove={handleMove}
        onExport={handleExport}
      />

      {/* Editor Modal */}
      {patient && (
        <DeviceLeadEditor
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          patient={patient}
          onSave={handlePatientUpdate}
          deviceTypeAliases={deviceTypeAliases}
        />
      )}

      {/* Rescan Merge Modal */}
      <DataMergeModal
        open={isMergeOpen}
        currentPatient={patient}
        scannedData={scannedData}
        onConfirm={handleMergeConfirm}
        onCancel={() => { setIsMergeOpen(false); setScannedData(null); }}
      />

      {/* Move Visit Modal */}
      <PatientAssignmentModal
        open={isAssignmentOpen}
        mode="move"
        sourceItem={visitToMove}
        excludePatientId={patientId}
        onResolve={handleMoveConfirm}
        onCancel={() => { setIsAssignmentOpen(false); setVisitToMove(null); }}
      />
    </div>
  );
};

// Compact MRI link badge — opens manufacturer's MRI check page
const MriCompactBadge: React.FC<{ manufacturer?: string }> = ({ manufacturer }) => {
  const url = getMriCheckUrl(manufacturer);
  if (!url) return null;

  const openCheck = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    window.electronAPI.openExternal(url);
  };

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-foreground/70 bg-muted border border-border font-medium cursor-pointer hover:bg-accent transition-colors"
      aria-label="Check MRI compatibility"
      title={`Open ${manufacturer} MRI compatibility check`}
      onClick={openCheck}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCheck(e);
        }
      }}
    >
      <ExternalLink className="h-3 w-3" /> Check MRI
    </span>
  );
};

export default PatientDetail;

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Calendar, Activity, Battery, Zap, Pencil } from 'lucide-react';
import ViewPane from '@/components/ViewPane';
import VisitTimeline from '@/components/VisitTimeline';
import DeviceLeadEditor from '@/components/DeviceLeadEditor';
import PatientAssignmentModal from '@/components/PatientAssignmentModal';
import DataMergeModal from '@/components/DataMergeModal';

interface PatientDetailProps {
  patientId: string;
  onBack: () => void;
}

const PatientDetail: React.FC<PatientDetailProps> = ({ patientId, onBack }) => {
  // console.log('[PatientDetail] Received patientId:', patientId, 'Type:', typeof patientId);
  const [patient, setPatient] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReports, setSelectedReports] = useState<(any | null)[]>([null, null]);
  const [activePaneId, setActivePaneId] = useState(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

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
      // Fetch patient data (from DB or filesystem - currently DB for ID lookup)
      const patientData = await window.electronAPI.getPatientById(patientId);

      // Fetch visits from filesystem
      const visitsData = await window.electronAPI.getVisitDirectories(patientId);

      setPatient(patientData);
      setReports(visitsData);

      // Auto-select the first report in pane 0 if nothing selected
      if (visitsData.length > 0 && !selectedReports[0]) {
        setSelectedReports([visitsData[0], null]);
      }
    } catch (error) {
      console.error('Failed to load patient data:', error);
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
      alert(`Failed to update: ${error}`);
    }
  };

  const handleReportSelect = (paneId: number, report: any | null) => {
    const newSelected = [...selectedReports];
    newSelected[paneId] = report;
    setSelectedReports(newSelected);
  };

  const handleVisitSelect = (visit: any) => {
    const emptyPaneIndex = selectedReports.findIndex(r => r === null);
    const targetPane = emptyPaneIndex >= 0 ? emptyPaneIndex : 0;
    handleReportSelect(targetPane, visit);
  };

  // --- Rescan Logic ---
  const handleRescan = async (visit: any) => {
    try {
      console.log('Rescanning visit:', visit.id);
      const result = await window.electronAPI.rescanVisit(visit.id);

      if (result.status === 'success' && result.scannedData) {
        setScannedData(result.scannedData);
        setIsMergeOpen(true);
      } else {
        alert('Rescan completed but no usable data found to merge.');
      }
    } catch (error) {
      console.error('Rescan failed:', error);
      alert('Failed to rescan visit. See console for details.');
    }
  };

  const handleMergeConfirm = async (mergedData: any) => {
    try {
      // Merge expects a full patient object update
      await handlePatientUpdate(mergedData);
      setIsMergeOpen(false);
      setScannedData(null);
    } catch (error) {
      console.error('Merge failed:', error);
    }
  };

  // --- Move Logic ---
  const handleMove = (visit: any) => {
    setVisitToMove({ ...visit, fileCount: visit.fileCount || 0 }); // Ensure needed props
    setIsAssignmentOpen(true);
  };

  const handleMoveConfirm = async (decision: any) => {
    if (!visitToMove || decision.action !== 'move-visit') return;

    try {
      await window.electronAPI.moveVisit(visitToMove.id, decision.targetPatientId);
      setIsAssignmentOpen(false);
      setVisitToMove(null);
      // Reload to reflect removal of visit
      await loadPatientData();
    } catch (error) {
      console.error('Move failed:', error);
      alert('Failed to move visit.');
    }
  };

  // Get latest report for header data
  const latestReport = reports[0];

  if (loading && !patient) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading patient data...</div>
      </div>
    );
  }

  if (!patient && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="text-muted-foreground">Patient not found</div>
        <Button onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Compact Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm h-14 flex items-center px-4 gap-4 shrink-0">
        {/* Left: Navigation & Patient Info */}
        <div className="flex items-center gap-3 shrink-0 border-r border-border/50 pr-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0 hover:bg-muted/50 rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold leading-none truncate max-w-[200px]">{patient?.name}</h1>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-primary p-0"
                onClick={() => setIsEditorOpen(true)}
                title="Edit Patient & Devices"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono opacity-80">{patient?.patientId}</span>
              <span>•</span>
              <span>{patient?.dob}</span>
            </div>
          </div>
        </div>

        {/* Middle: Scrollable History (Devices & Leads) */}
        <div className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-2 mask-linear-fade">
          {/* Devices */}
          {patient?.devices && patient.devices.length > 0 && patient.devices.map((device: any, idx: number) => (
            <div key={`dev-${idx}`} className="flex items-center gap-1.5 px-2 py-1 bg-primary/5 border border-primary/10 rounded-md shrink-0 text-[10px] whitespace-nowrap">
              <Activity className="h-3 w-3 text-primary/70" />
              <div className="flex flex-col leading-none gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-foreground/80">{device.model}</span>
                  <span className="font-mono text-muted-foreground opacity-70">({device.serial})</span>
                </div>
                {device.type && <span className="text-[9px] text-muted-foreground opacity-60 uppercase tracking-tighter">{device.type}</span>}
              </div>
            </div>
          ))}

          {/* Leads */}
          {patient?.leads && patient.leads.length > 0 && patient.leads.map((lead: any, idx: number) => (
            <div key={`lead-${idx}`} className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/5 border border-yellow-500/10 rounded-md shrink-0 text-[10px] whitespace-nowrap">
              <Zap className="h-3 w-3 text-yellow-600/70" />
              <div className="flex flex-col leading-none gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-foreground/80">{lead.model}</span>
                  <span className="font-mono text-muted-foreground opacity-70">({lead.serial})</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground opacity-60 uppercase tracking-tighter">
                  {lead.type && <span>{lead.type}</span>}
                  {lead.connector && <span>• {lead.connector}</span>}
                </div>
              </div>
            </div>
          ))}

          {(!patient?.devices?.length && !patient?.leads?.length) && (
            <span className="text-[10px] text-muted-foreground italic px-2">No device history</span>
          )}
        </div>

        {/* Right: Stats */}
        <div className="shrink-0 pl-2 border-l border-border/50">
          <Badge variant="secondary" className="text-[10px] h-6 px-2 bg-secondary/50">
            {reports.length} Visits
          </Badge>
        </div>
      </div>

      {/* Main Content - 2 Pane Viewer */}
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-2 h-full">
          <ViewPane
            paneId={0}
            patientId={patientId}
            selectedReport={selectedReports[0]}
            availableReports={reports}
            onReportSelect={handleReportSelect}
            isActive={activePaneId === 0}
            onActivate={() => setActivePaneId(0)}
          />
          <ViewPane
            paneId={1}
            patientId={patientId}
            selectedReport={selectedReports[1]}
            availableReports={reports}
            onReportSelect={handleReportSelect}
            isActive={activePaneId === 1}
            onActivate={() => setActivePaneId(1)}
          />
        </div>
      </div>

      {/* Timeline */}
      <VisitTimeline
        visits={reports.map(r => ({
          id: r.id,
          interrogation_date: r.interrogation_date,
          manufacturer: r.manufacturer,
          fileCount: r.files?.length
        }))}
        onVisitSelect={handleVisitSelect}
        onRescan={handleRescan}
        onMove={handleMove}
      />

      {/* Editor Modal */}
      {patient && (
        <DeviceLeadEditor
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          patient={patient}
          onSave={handlePatientUpdate}
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
        onResolve={handleMoveConfirm}
        onCancel={() => { setIsAssignmentOpen(false); setVisitToMove(null); }}
      />
    </div>
  );
};

export default PatientDetail;

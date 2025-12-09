import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Calendar, Activity, Battery, Zap } from 'lucide-react';
import ViewPane from '@/components/ViewPane';
import VisitTimeline from '@/components/VisitTimeline';

interface PatientDetailProps {
  patientId: string;
  onBack: () => void;
}

const PatientDetail: React.FC<PatientDetailProps> = ({ patientId, onBack }) => {
  console.log('[PatientDetail] Received patientId:', patientId, 'Type:', typeof patientId);
  const [patient, setPatient] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReports, setSelectedReports] = useState<(any | null)[]>([null, null]);
  const [activePaneId, setActivePaneId] = useState(0);

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

      // Auto-select the first report in pane 0
      if (visitsData.length > 0) {
        setSelectedReports([visitsData[0], null]);
      }
    } catch (error) {
      console.error('Failed to load patient data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReportSelect = (paneId: number, report: any | null) => {
    const newSelected = [...selectedReports];
    newSelected[paneId] = report;
    setSelectedReports(newSelected);
  };

  const handleVisitSelect = (visit: any) => {
    // Find the first empty pane, or use pane 0
    const emptyPaneIndex = selectedReports.findIndex(r => r === null);
    const targetPane = emptyPaneIndex >= 0 ? emptyPaneIndex : 0;
    handleReportSelect(targetPane, visit);
  };

  // Get latest report for header data
  const latestReport = reports[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading patient data...</div>
      </div>
    );
  }

  if (!patient) {
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
            <h1 className="text-sm font-bold leading-none truncate max-w-[200px]">{patient.name}</h1>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono opacity-80">{patient.patientId}</span>
              <span>•</span>
              <span>{patient.dob}</span>
            </div>
          </div>
        </div>

        {/* Middle: Scrollable History (Devices & Leads) */}
        <div className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-2 mask-linear-fade">
          {/* Devices */}
          {patient.devices && patient.devices.length > 0 && patient.devices.map((device: any, idx: number) => (
            <div key={`dev-${idx}`} className="flex items-center gap-1.5 px-2 py-1 bg-primary/5 border border-primary/10 rounded-md shrink-0 text-[10px] whitespace-nowrap">
              <Activity className="h-3 w-3 text-primary/70" />
              <span className="font-semibold text-foreground/80">{device.model}</span>
              <span className="font-mono text-muted-foreground opacity-70">{device.serial}</span>
              <span className="text-muted-foreground border-l border-primary/10 pl-1.5 ml-0.5">{device.implant_date}</span>
            </div>
          ))}

          {/* Leads */}
          {patient.leads && patient.leads.length > 0 && patient.leads.map((lead: any, idx: number) => (
            <div key={`lead-${idx}`} className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/5 border border-yellow-500/10 rounded-md shrink-0 text-[10px] whitespace-nowrap">
              <Zap className="h-3 w-3 text-yellow-600/70" />
              <span className="font-semibold text-foreground/80">{lead.model}</span>
              <span className="font-mono text-muted-foreground opacity-70">{lead.serial}</span>
              <span className="text-muted-foreground border-l border-yellow-500/10 pl-1.5 ml-0.5">{lead.implant_date}</span>
            </div>
          ))}

          {(!patient.devices?.length && !patient.leads?.length) && (
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
          fileCount: r.files?.length // Optional now
        }))}
        onVisitSelect={handleVisitSelect}
      />
    </div>
  );
};

export default PatientDetail;

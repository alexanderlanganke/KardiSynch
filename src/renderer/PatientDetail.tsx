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
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-xl font-bold leading-none">{patient.name}</h1>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {patient.patientId}
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    DOB: {patient.dob}
                  </div>
                </div>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs px-2 py-0.5">
              {reports.length} Visits
            </Badge>
          </div>

          {/* Device & Lead Summary - Compact Row */}
          {latestReport && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {/* Device Card */}
              {(latestReport.device_model || latestReport.device?.model) && (
                <Card className="glass-card border-primary/10 flex-shrink-0 p-2 flex items-center gap-3 min-w-[200px]">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs font-semibold">{latestReport.device_model || latestReport.device?.model || 'N/A'}</div>
                    <div className="text-[10px] text-muted-foreground font-mono leading-none">
                      {latestReport.device_serial || latestReport.device?.serial_number || 'N/A'}
                    </div>
                  </div>
                </Card>
              )}

              {/* Battery Card - Only if available (DB only) */}
              {latestReport.battery && (
                <Card className="glass-card border-primary/10 flex-shrink-0 p-2 flex items-center gap-3 min-w-[180px]">
                  <Battery className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs font-semibold">
                      {latestReport.battery.voltage?.value} {latestReport.battery.voltage?.unit}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-none">
                      {latestReport.battery.remaining_longevity?.value} {latestReport.battery.remaining_longevity?.unit} left
                    </div>
                  </div>
                </Card>
              )}

              {/* Leads Card - Only if available (DB only) */}
              {latestReport.leads && latestReport.leads.length > 0 && (
                <Card className="glass-card border-primary/10 flex-shrink-0 p-2 flex items-center gap-3">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <div className="flex gap-3">
                    {latestReport.leads.map((lead: any, idx: number) => (
                      <div key={idx} className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground leading-none">{lead.name}</span>
                        <span className="text-xs font-medium leading-none">{lead.impedance?.value} Ω</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
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
          />
          <ViewPane
            paneId={1}
            patientId={patientId}
            selectedReport={selectedReports[1]}
            availableReports={reports}
            onReportSelect={handleReportSelect}
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

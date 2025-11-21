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
      const [patientData, reportsData] = await Promise.all([
        window.electronAPI.getPatientById(patientId),
        window.electronAPI.getPatientReports(patientId)
      ]);

      setPatient(patientData);
      setReports(reportsData);

      // Auto-select the first report in pane 0
      if (reportsData.length > 0) {
        setSelectedReports([reportsData[0], null]);
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
        <div className="p-6 space-y-4">
          {/* Navigation */}
          <Button variant="ghost" onClick={onBack} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Patients
          </Button>

          {/* Patient Info */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold">{patient.name}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  {patient.patientId}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  DOB: {patient.dob}
                </div>
              </div>
            </div>
            <Badge variant="secondary" className="text-lg px-4 py-2">
              {reports.length} Reports
            </Badge>
          </div>

          {/* Device & Lead Summary */}
          {latestReport && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {/* Device Card */}
              {latestReport.device && (
                <Card className="glass-card border-primary/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Device
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="font-semibold">{latestReport.device.model || 'N/A'}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {latestReport.device.serial_number || 'N/A'}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Battery Card */}
              {latestReport.battery && (
                <Card className="glass-card border-primary/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Battery className="h-4 w-4" />
                      Battery
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="font-semibold">
                      {latestReport.battery.voltage?.value} {latestReport.battery.voltage?.unit}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {latestReport.battery.remaining_longevity?.value}
                      {latestReport.battery.remaining_longevity?.unit} remaining
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Leads Card */}
              {latestReport.leads && latestReport.leads.length > 0 && (
                <Card className="glass-card border-primary/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Leads
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs space-y-1">
                      {latestReport.leads.map((lead: any, idx: number) => (
                        <div key={idx} className="flex justify-between">
                          <span className="text-muted-foreground">{lead.name}:</span>
                          <span className="font-medium">{lead.impedance?.value} Ω</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
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
            selectedReport={selectedReports[0]}
            availableReports={reports}
            onReportSelect={handleReportSelect}
          />
          <ViewPane
            paneId={1}
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
          fileCount: r.files?.length || 0
        }))}
        onVisitSelect={handleVisitSelect}
      />
    </div>
  );
};

export default PatientDetail;

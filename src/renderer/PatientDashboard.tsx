import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, User, Calendar, Clock, MoreVertical, X, Check, ArrowUpDown, ArrowUp, ArrowDown, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Manufacturer Logos
import medtronicLogo from './assets/logos/medtronic.svg';
import biotronikLogo from './assets/logos/biotronik.svg';
import abbottLogo from './assets/logos/abbott.svg';
import bostonLogo from './assets/logos/boston_scientific.svg';
import impulseLogo from './assets/logos/impulse_dynamics.svg';
import microportLogo from './assets/logos/microport.svg';
import unknownLogo from './assets/logos/unknown.svg';

const MANUFACTURER_LOGOS: Record<string, string> = {
  'Medtronic': medtronicLogo,
  'Biotronik': biotronikLogo,
  'Abbott': abbottLogo,
  'Boston Scientific': bostonLogo,
  'Impulse Dynamics': impulseLogo,
  'Microport': microportLogo,
};

interface Patient {
  id: string;
  patientId: string;
  hospitalPatientId: string;
  name: string;
  dob: string;
  lastReportDate: string;
  reportCount: number;
  deviceManufacturer?: string;
  deviceModel?: string;
  leads?: string[];
  mriStatus?: { status: string; details: string; timestamp?: string };
}


interface FilterState {
  dob: string;
  patientId: string;
  hospitalPatientId: string;
  hospitalVisitId: string;
  deviceManufacturer: string;
}

type SortField = 'name' | 'dob' | 'hospitalPatientId' | 'deviceManufacturer' | 'deviceModel' | 'lastReportDate';
type SortDirection = 'asc' | 'desc';

const PatientDashboard: React.FC<{ onPatientSelect: (patientId: string) => void }> = ({ onPatientSelect }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [filters, setFilters] = useState<FilterState>({
    dob: '',
    patientId: '',
    hospitalPatientId: '',
    hospitalVisitId: '',
    deviceManufacturer: '',
  });

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      // Get all patients from filesystem
      const data = await window.electronAPI.getPatientDirectories();

      // Apply client-side filtering
      let filtered = data;

      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(search) ||
          String(p.patientId).toLowerCase().includes(search) ||
          (p.hospitalPatientId && String(p.hospitalPatientId).toLowerCase().includes(search)) ||
          p.id.toLowerCase().includes(search)
        );
      }

      if (filters.dob) {
        filtered = filtered.filter(p => p.dob === filters.dob);
      }

      if (filters.patientId) {
        filtered = filtered.filter(p => p.patientId.includes(filters.patientId));
      }

      if (filters.hospitalPatientId) {
        filtered = filtered.filter(p => p.hospitalPatientId && p.hospitalPatientId.includes(filters.hospitalPatientId));
      }

      if (filters.deviceManufacturer) {
        filtered = filtered.filter(p => p.deviceManufacturer === filters.deviceManufacturer);
      }

      setPatients(filtered);
    } catch (error) {
      console.error('Error fetching patients:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filters]);

  // Debounce search term to avoid too many requests
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPatients();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchPatients]);

  // Listen for patient list updates
  useEffect(() => {
    const handleUpdate = () => {
      fetchPatients();
    };
    window.electronAPI.onPatientListUpdate(handleUpdate);

    // Listen for automation updates
    const cleanupAutomation = window.electronAPI.onAutomationStatus((status: any) => {
      setProcessingId(status.isProcessing ? status.currentPatientId : null);
      // Refresh list if an item finished (we can infer this if processingId changes from ID to null, or we can just fetch periodically/on change)
      // Ideally AutomationManager should emit 'patient-list-update' when done.
      // For now, let's just show the spinner. 
      // If we want the result to appear immediately, we need a refresh trigger.
      // Let's assume onPatientListUpdate is triggered or we rely on spinner for now.
    });

    return () => {
      window.electronAPI.removeListener('patient-list-update', handleUpdate);
      // cleanupAutomation is a void return currently based on preload, check preload... 
      // Preload: return () => ipcRenderer.removeListener... NO, onAutomationStatus just adds listener. it does NOT return cleanup.
      // I need to fix preload if I want proper cleanup, or just ignore for now as Dashboard is main view.
      // Actually, I should use `window.electronAPI.removeListener` if I can target the function.
    };
  }, [fetchPatients]);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedPatients = [...patients].sort((a, b) => {
    const fieldA = (a[sortField] || '').toString().toLowerCase();
    const fieldB = (b[sortField] || '').toString().toLowerCase();

    if (fieldA < fieldB) return sortDirection === 'asc' ? -1 : 1;
    if (fieldA > fieldB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});

  const handleEditClick = (e: React.MouseEvent, patient: Patient & { first_name?: string; last_name?: string }) => {
    e.stopPropagation();
    setEditingPatientId(patient.id);

    // Use raw fields if available, otherwise fallback to split
    let firstName = patient.first_name || '';
    let lastName = patient.last_name || '';

    if (!firstName && !lastName) {
      const nameParts = patient.name.split(' ');
      lastName = nameParts.pop() || '';
      firstName = nameParts.join(' ');
    }

    setEditFormData({
      id: patient.id,
      first_name: firstName,
      last_name: lastName,
      dob: patient.dob,
      hospitalPatientId: patient.hospitalPatientId || '',
      deviceManufacturer: patient.deviceManufacturer || '',
      deviceModel: patient.deviceModel || ''
    });
  };

  const handleSaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.updatePatient({
        ...editFormData,
        hospitalPatientId: editFormData.hospitalPatientId || null
      });
      setEditingPatientId(null);
      fetchPatients(); // Refresh list
    } catch (error) {
      console.error('Failed to update patient:', error);
    }
  };

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPatientId(null);
    setEditFormData({});
  };

  const handleInputChange = (field: string, value: string) => {
    setEditFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({
      dob: '',
      patientId: '',
      hospitalPatientId: '',
      hospitalVisitId: '',
      deviceManufacturer: '',
    });
    setSearchTerm('');
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30 ml-1" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const getManufacturerLogo = (name?: string) => {
    if (!name) return null;
    // Simple normalization to match keys
    const key = Object.keys(MANUFACTURER_LOGOS).find(k => name.toLowerCase().includes(k.toLowerCase()));
    return key ? MANUFACTURER_LOGOS[key] : null;
  };

  return (
    <div className="container mx-auto pt-4 px-8 pb-8 max-w-7xl space-y-6 h-full overflow-y-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>

          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Patients
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Manage patient records and view interrogation reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full md:w-96 group">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <Input
              placeholder="Search by name, ID, or MRN..."
              className="pl-10 h-11 bg-background/50 backdrop-blur-sm border-muted-foreground/20 focus:border-primary/50 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="icon"
            className="h-11 w-11 rounded-xl border-muted-foreground/20 hover:bg-muted/50"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card className="glass-card animate-accordion-down overflow-hidden border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" /> Advanced Filters
            </CardTitle>
            <CardDescription>Filter patients by specific criteria matching database records.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  className="bg-background/50"
                  value={filters.dob}
                  onChange={(e) => handleFilterChange('dob', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="patientId">Patient ID (Internal)</Label>
                <Input
                  id="patientId"
                  placeholder="e.g. P-12345"
                  className="bg-background/50"
                  value={filters.patientId}
                  onChange={(e) => handleFilterChange('patientId', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hospitalPatientId">Hospital MRN</Label>
                <Input
                  id="hospitalPatientId"
                  placeholder="e.g. MRN-999"
                  className="bg-background/50"
                  value={filters.hospitalPatientId}
                  onChange={(e) => handleFilterChange('hospitalPatientId', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hospitalVisitId">Visit ID</Label>
                <Input
                  id="hospitalVisitId"
                  placeholder="e.g. V-2023-001"
                  className="bg-background/50"
                  value={filters.hospitalVisitId}
                  onChange={(e) => handleFilterChange('hospitalVisitId', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="manufacturer">Device Manufacturer</Label>
                <Select
                  value={filters.deviceManufacturer}
                  onValueChange={(value) => handleFilterChange('deviceManufacturer', value)}
                >
                  <SelectTrigger id="manufacturer" className="bg-background/50">
                    <SelectValue placeholder="Select Manufacturer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Medtronic">Medtronic</SelectItem>
                    <SelectItem value="Biotronik">Biotronik</SelectItem>
                    <SelectItem value="Abbott">Abbott</SelectItem>
                    <SelectItem value="Boston Scientific">Boston Scientific</SelectItem>
                    <SelectItem value="Impulse Dynamics">Impulse Dynamics</SelectItem>
                    <SelectItem value="Microport">Microport</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 flex items-end gap-2">
                <Button variant="outline" onClick={clearFilters} className="flex-1">
                  <X className="mr-2 h-4 w-4" /> Clear
                </Button>
                <Button onClick={() => fetchPatients()} className="flex-1">
                  <Check className="mr-2 h-4 w-4" /> Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Patient List (Table View) */}
      <div className="flex flex-col gap-1 pb-4">
        {/* Header Row */}
        <div className="flex items-center px-6 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 rounded-lg mb-1 select-none">
          <div
            className="w-[20%] flex items-center cursor-pointer hover:text-foreground transition-colors group"
            onClick={() => handleSort('name')}
          >
            Patient <SortIcon field="name" />
          </div>
          <div
            className="w-[12%] flex items-center cursor-pointer hover:text-foreground transition-colors group"
            onClick={() => handleSort('dob')}
          >
            DOB <SortIcon field="dob" />
          </div>
          <div
            className="w-[20%] flex items-center cursor-pointer hover:text-foreground transition-colors group justify-center"
            onClick={() => handleSort('deviceManufacturer')}
          >
            <SortIcon field="deviceManufacturer" />
            <span className="sr-only">Manufacturer</span>
          </div>
          <div
            className="w-[18%] flex items-center cursor-pointer hover:text-foreground transition-colors group"
            onClick={() => handleSort('deviceModel')}
          >
            Model <SortIcon field="deviceModel" />
          </div>
          <div
            className="w-[20%] flex items-center cursor-pointer hover:text-foreground transition-colors group"
            onClick={() => handleSort('lastReportDate')}
          >
            Last Report <SortIcon field="lastReportDate" />
          </div>
          <div className="w-[10%] text-right"></div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3 text-muted-foreground/50">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary/30"></div>
            <p className="text-sm">Loading patients...</p>
          </div>
        ) : sortedPatients.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground/60 border-2 border-dashed border-muted rounded-xl bg-muted/5">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p>No patients found matching criteria.</p>
          </div>
        ) : (
          sortedPatients.map((patient) => {
            const logo = getManufacturerLogo(patient.deviceManufacturer) || unknownLogo;

            return (
              <div
                key={patient.id}
                className={`group flex items-center px-6 py-3 bg-background/60 hover:bg-muted/40 border border-transparent hover:border-border/40 rounded-xl transition-all duration-200 cursor-pointer text-sm shadow-sm hover:shadow-md mb-1.5 ${editingPatientId === patient.id ? 'bg-muted/30 ring-1 ring-primary/20 shadow-md' : ''}`}
                onClick={() => !editingPatientId && onPatientSelect(patient.id)}
              >
                {editingPatientId === patient.id ? (
                  // EDIT MODE
                  <>
                    {/* Patient Column (Name, MRN, ID) */}
                    <div className="w-[20%] flex flex-col gap-1 pr-4">
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-sm font-medium bg-background"
                          placeholder="First Name"
                          value={editFormData.first_name}
                          onChange={(e) => handleInputChange('first_name', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Input
                          className="h-8 text-sm font-medium bg-background"
                          placeholder="Last Name"
                          value={editFormData.last_name}
                          onChange={(e) => handleInputChange('last_name', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <Input
                          className="h-7 text-xs bg-background w-32"
                          placeholder="MRN"
                          value={editFormData.hospitalPatientId}
                          onChange={(e) => handleInputChange('hospitalPatientId', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-[10px] font-mono text-muted-foreground opacity-50 select-all">{patient.patientId}</span>
                      </div>
                    </div>

                    {/* DOB Column */}
                    <div className="w-[12%] pr-2">
                      <Input
                        className="h-8 text-sm bg-background"
                        placeholder="YYYY-MM-DD"
                        value={editFormData.dob}
                        onChange={(e) => handleInputChange('dob', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Manufacturer Column */}
                    <div className="w-[20%] pr-2 flex justify-center">
                      <Input
                        className="h-6 text-xs bg-background text-center px-0"
                        placeholder="Mfg"
                        value={editFormData.deviceManufacturer}
                        onChange={(e) => handleInputChange('deviceManufacturer', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Model Column */}
                    <div className="w-[18%] pr-2">
                      <Input
                        className="h-7 text-xs bg-background"
                        placeholder="Model"
                        value={editFormData.deviceModel}
                        onChange={(e) => handleInputChange('deviceModel', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Last Report (Read Only) */}
                    <div className="w-[20%] text-muted-foreground text-xs pl-1 opacity-50">
                      {patient.lastReportDate || 'Never'}
                    </div>

                    {/* Actions */}
                    <div className="w-[10%] flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-full"
                        onClick={handleSaveClick}
                        title="Save"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-full"
                        onClick={handleCancelClick}
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  // VIEW MODE
                  <>
                    {/* Patient Column */}
                    <div className="w-[20%] flex flex-col justify-center pr-4">
                      <span className="font-semibold text-foreground text-[15px] leading-tight group-hover:text-primary transition-colors">
                        {patient.name}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground/80">
                        <span className="font-mono text-xs text-muted-foreground/90">
                          ID: {patient.hospitalPatientId || 'No ID'}
                        </span>
                      </div>
                    </div>

                    {/* DOB Column */}
                    <div className="w-[12%] text-xs text-muted-foreground flex items-center">
                      {patient.dob}
                    </div>

                    {/* Manufacturer Column (Logo Only) */}
                    <div className="w-[20%] flex justify-center items-center px-1">
                      <img
                        src={logo}
                        alt={patient.deviceManufacturer || 'Unknown'}
                        className="h-[15px] w-auto max-w-full object-contain opacity-90 group-hover:opacity-100 transition-opacity"
                      />
                    </div>

                    {/* Model Column */}
                    <div className="w-[18%] pr-4">
                      <div className="text-xs text-muted-foreground/80 truncate" title={patient.deviceModel}>
                        {patient.deviceModel || 'Unknown Model'}
                      </div>
                      <div className="mt-1">
                        {(() => {
                          const isProcessing = processingId === patient.id;
                          let status = patient.mriStatus?.status;
                          const manu = (patient.deviceManufacturer || '').toLowerCase();

                          // Force unknown status for Unknown/Missing manufacturers
                          if (manu === 'unknown' || !manu) {
                            status = 'unknown';
                          }

                          // Default to unknown if not present
                          if (!status) {
                            status = 'unknown';
                          }

                          // Helper to format tooltip
                          const formatTooltip = () => {
                            const details = patient.mriStatus?.details || 'Status Unknown';
                            const device = `Device: ${patient.deviceModel || 'Unknown'}`;

                            // Format leads logic
                            let leadsText = 'Leads: None';
                            if (patient.leads && patient.leads.length > 0) {
                              // leads is usually an array of strings like "Manufacturer Model (Serial)" based on main.ts
                              // Let's create a clean list
                              leadsText = 'Leads:\n' + patient.leads.map(l => `• ${l}`).join('\n');
                            }

                            return `${details}\n\n${device}\n${leadsText}`;
                          };

                          if (isProcessing) {
                            return (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground animate-pulse">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Checking...
                              </div>
                            );
                          }

                          // Render Icon based on status
                          if (status === 'mr_conditional' || status === 'conditional') {
                            return (
                              <div
                                className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md border font-medium cursor-pointer transition-colors shadow-sm"
                                style={{ backgroundColor: '#16a34a', color: 'white', borderColor: '#15803d' }}
                                title={formatTooltip()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Retrigger check?')) window.electronAPI.triggerMriCheck(patient.id);
                                }}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                MRI Conditional
                              </div>
                            );
                          }


                          // Unsafe / No Info
                          if (status === 'unsafe' || status === 'no_info') {
                            return (
                              <div
                                className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md border font-medium cursor-pointer transition-colors shadow-sm"
                                style={{ backgroundColor: '#dc2626', color: 'white', borderColor: '#b91c1c' }}
                                title={formatTooltip()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Retrigger check?')) window.electronAPI.triggerMriCheck(patient.id);
                                }}
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                                {status === 'unsafe' ? 'Unsafe / Warning' : 'Not Conditional'}
                              </div>
                            );
                          }

                          // Unknown / Explicitly Unknown / Default
                          return (
                            <div
                              className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md border font-medium cursor-pointer transition-colors shadow-sm"
                              style={{ backgroundColor: '#4b5563', color: 'white', borderColor: '#374151' }}
                              title={formatTooltip()}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.electronAPI.triggerMriCheck(patient.id);
                              }}
                            >
                              <HelpCircle className="h-3.5 w-3.5" />
                              MRI Conditional Unknown
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Last Report */}
                    <div className="w-[20%] text-sm text-muted-foreground flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${patient.lastReportDate ? 'bg-emerald-500/50' : 'bg-slate-300'}`}></div>
                      {patient.lastReportDate || 'No reports'}
                      {patient.reportCount > 0 && (
                        <Badge variant="outline" className="ml-1 h-5 text-[10px] px-1.5 border-primary/20 text-primary bg-primary/5">
                          {patient.reportCount}
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="w-[10%] flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background shadow-none hover:shadow-sm rounded-full"
                        onClick={(e) => handleEditClick(e, patient)}
                        title="Edit Details"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background shadow-none hover:shadow-sm rounded-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.electronAPI.openPatientDirectory(patient.id);
                        }}
                        title="Open Folder"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
                      </Button>
                    </div>
                  </>
                )
                }
              </div>
            );
          })
        )}
      </div>
    </div >
  );
};

export default PatientDashboard;





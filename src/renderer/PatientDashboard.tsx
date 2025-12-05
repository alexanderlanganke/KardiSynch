import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, User, Calendar, Clock, MoreVertical, X, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';



interface Patient {
  id: string;
  patientId: string;
  name: string;
  dob: string;
  lastReportDate: string;
  reportCount: number;
  deviceManufacturer?: string;
  deviceModel?: string;
  leads?: string[];
}

interface FilterState {
  dob: string;
  patientId: string;
  hospitalPatientId: string;
  hospitalVisitId: string;
  deviceManufacturer: string;
}

const PatientDashboard: React.FC<{ onPatientSelect: (patientId: string) => void }> = ({ onPatientSelect }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);

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
          p.patientId.toLowerCase().includes(search)
        );
      }

      if (filters.dob) {
        filtered = filtered.filter(p => p.dob === filters.dob);
      }

      if (filters.patientId) {
        filtered = filtered.filter(p => p.patientId.includes(filters.patientId));
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
    return () => {
      window.electronAPI.removeListener('patient-list-update', handleUpdate);
    };
  }, [fetchPatients]);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
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
              placeholder="Search by name..."
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
        <div className="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30 rounded-lg mb-1">
          <div className="w-[20%] min-w-[150px]">Name / ID</div>
          <div className="w-[15%] min-w-[100px]">DOB</div>
          <div className="w-[20%] min-w-[120px]">Device</div>
          <div className="w-[20%] min-w-[120px]">Model</div>
          <div className="w-[15%] min-w-[100px]">Last Report</div>
          <div className="w-[10%] text-right">Actions</div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading patients...</div>
        ) : patients.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No patients found matching criteria.</div>
        ) : (
          patients.map((patient) => (
            <div
              key={patient.id}
              className="group flex items-center px-4 py-2 bg-background/40 hover:bg-muted/50 border border-transparent hover:border-border/50 rounded-lg transition-all cursor-pointer text-sm"
              onClick={() => onPatientSelect(patient.id)}
            >
              {/* Name & ID */}
              <div className="w-[20%] min-w-[150px] flex flex-col justify-center pr-2">
                <span className="font-semibold truncate text-foreground/90">{patient.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground opacity-70">{patient.patientId}</span>
              </div>

              {/* DOB */}
              <div className="w-[15%] min-w-[100px] text-muted-foreground flex items-center">
                <Calendar className="mr-1.5 h-3 w-3 opacity-50" />
                {patient.dob}
              </div>

              {/* Manufacturer */}
              <div className="w-[20%] min-w-[120px] text-muted-foreground truncate pr-2">
                {patient.deviceManufacturer || '-'}
              </div>

              {/* Model */}
              <div className="w-[20%] min-w-[120px] text-muted-foreground truncate pr-2" title={patient.deviceModel}>
                {patient.deviceModel || '-'}
              </div>

              {/* Last Report */}
              <div className="w-[15%] min-w-[100px] text-muted-foreground flex items-center">
                <Clock className="mr-1.5 h-3 w-3 opacity-50" />
                {patient.lastReportDate || 'Never'}
                {patient.reportCount > 0 && (
                  <Badge variant="secondary" className="ml-2 h-4 text-[9px] px-1 bg-secondary/40">
                    {patient.reportCount}
                  </Badge>
                )}
              </div>

              {/* Actions */}
              <div className="w-[10%] flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background hover:shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.electronAPI.openPatientDirectory(patient.id);
                  }}
                  title="Open Patient Directory"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PatientDashboard;

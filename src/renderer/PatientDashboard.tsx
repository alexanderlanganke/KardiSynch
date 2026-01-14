import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, User, Calendar, Clock, MoreVertical, X, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Manufacturer Logos
import medtronicLogo from './assets/logos/medtronic.svg';
import biotronikLogo from './assets/logos/biotronik.svg';
import abbottLogo from './assets/logos/abbott.svg';
import bostonLogo from './assets/logos/boston_scientific.svg';
import impulseLogo from './assets/logos/impulse_dynamics.svg';
import microportLogo from './assets/logos/microport.svg';

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
          p.patientId.toLowerCase().includes(search) ||
          (p.hospitalPatientId && p.hospitalPatientId.toLowerCase().includes(search))
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
    return () => {
      window.electronAPI.removeListener('patient-list-update', handleUpdate);
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
        <div className="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30 rounded-lg mb-1 select-none">
          <div
            className="w-[20%] min-w-[150px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('name')}
          >
            Name / ID <SortIcon field="name" />
          </div>
          <div
            className="w-[12%] min-w-[100px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('hospitalPatientId')}
          >
            Hospital MRN <SortIcon field="hospitalPatientId" />
          </div>
          <div
            className="w-[12%] min-w-[90px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('dob')}
          >
            DOB <SortIcon field="dob" />
          </div>
          <div
            className="w-[18%] min-w-[110px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('deviceManufacturer')}
          >
            Manufacturer <SortIcon field="deviceManufacturer" />
          </div>
          <div
            className="w-[18%] min-w-[110px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('deviceModel')}
          >
            Model <SortIcon field="deviceModel" />
          </div>
          <div
            className="w-[12%] min-w-[100px] flex items-center cursor-pointer hover:text-foreground transition-colors"
            onClick={() => handleSort('lastReportDate')}
          >
            Last Report <SortIcon field="lastReportDate" />
          </div>
          <div className="w-[8%] text-right">Actions</div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading patients...</div>
        ) : sortedPatients.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No patients found matching criteria.</div>
        ) : (
          sortedPatients.map((patient) => {
            const logo = getManufacturerLogo(patient.deviceManufacturer);

            return (
              <div
                key={patient.id}
                className={`group flex items-center px-4 py-2 bg-background/40 hover:bg-muted/50 border border-transparent hover:border-border/50 rounded-lg transition-all cursor-pointer text-sm ${editingPatientId === patient.id ? 'bg-muted/60 border-primary/20' : ''}`}
                onClick={() => !editingPatientId && onPatientSelect(patient.id)}
              >
                {editingPatientId === patient.id ? (
                  // EDIT MODE
                  <>
                    {/* Name & ID Inputs */}
                    <div className="w-[20%] min-w-[150px] flex flex-col gap-1 pr-2">
                      <div className="flex gap-1">
                        <Input
                          className="h-6 text-xs px-1"
                          placeholder="First"
                          value={editFormData.first_name}
                          onChange={(e) => handleInputChange('first_name', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Input
                          className="h-6 text-xs px-1 font-bold"
                          placeholder="Last"
                          value={editFormData.last_name}
                          onChange={(e) => handleInputChange('last_name', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      {/* Internal ID display only */}
                      <span className="text-[9px] font-mono text-muted-foreground opacity-50 px-1">{patient.patientId}</span>
                    </div>

                    {/* Hospital MRN Input */}
                    <div className="w-[12%] min-w-[100px] pr-2">
                      <Input
                        className="h-6 text-xs px-1"
                        placeholder="MRN"
                        value={editFormData.hospitalPatientId}
                        onChange={(e) => handleInputChange('hospitalPatientId', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* DOB Input */}
                    <div className="w-[12%] min-w-[90px] pr-2">
                      <Input
                        className="h-6 text-xs px-1"
                        placeholder="YYYY-MM-DD"
                        value={editFormData.dob}
                        onChange={(e) => handleInputChange('dob', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Device Input */}
                    <div className="w-[18%] min-w-[110px] pr-2">
                      <Input
                        className="h-6 text-xs px-1"
                        placeholder="Manufacturer"
                        value={editFormData.deviceManufacturer}
                        onChange={(e) => handleInputChange('deviceManufacturer', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Model Input */}
                    <div className="w-[18%] min-w-[110px] pr-2">
                      <Input
                        className="h-6 text-xs px-1"
                        placeholder="Model"
                        value={editFormData.deviceModel}
                        onChange={(e) => handleInputChange('deviceModel', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Read-only fields */}
                    <div className="w-[12%] min-w-[100px] text-muted-foreground opacity-50">
                      {patient.lastReportDate || 'Never'}
                    </div>

                    {/* Edit Actions */}
                    <div className="w-[8%] flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-100/20"
                        onClick={handleSaveClick}
                        title="Save"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-100/20"
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
                    {/* Name & ID */}
                    <div className="w-[20%] min-w-[150px] flex flex-col justify-center pr-2">
                      <span className="font-semibold truncate text-foreground/90">{patient.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground opacity-70">{patient.patientId}</span>
                    </div>

                    {/* Hospital MRN */}
                    <div className="w-[12%] min-w-[100px] text-muted-foreground truncate pr-2 text-xs">
                      {patient.hospitalPatientId || '-'}
                    </div>

                    {/* DOB */}
                    <div className="w-[12%] min-w-[90px] text-muted-foreground flex items-center">
                      <Calendar className="mr-1.5 h-3 w-3 opacity-50" />
                      {patient.dob}
                    </div>

                    {/* Manufacturer w/ Logo */}
                    <div className="w-[18%] min-w-[110px] text-muted-foreground truncate pr-2 flex items-center gap-2">
                      {logo && (
                        <img src={logo} alt={patient.deviceManufacturer} className="h-5 w-auto object-contain opacity-80" />
                      )}
                      <span className={logo ? "text-xs" : ""}>{patient.deviceManufacturer || '-'}</span>
                    </div>

                    {/* Model */}
                    <div className="w-[18%] min-w-[110px] text-muted-foreground truncate pr-2" title={patient.deviceModel}>
                      {patient.deviceModel || '-'}
                    </div>

                    {/* Last Report */}
                    <div className="w-[12%] min-w-[100px] text-muted-foreground flex items-center">
                      <Clock className="mr-1.5 h-3 w-3 opacity-50" />
                      {patient.lastReportDate || 'Never'}
                      {patient.reportCount > 0 && (
                        <Badge variant="secondary" className="ml-2 h-4 text-[9px] px-1 bg-secondary/40">
                          {patient.reportCount}
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="w-[8%] flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background hover:shadow-sm"
                        onClick={(e) => handleEditClick(e, patient)}
                        title="Edit Patient"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      </Button>
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
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PatientDashboard;





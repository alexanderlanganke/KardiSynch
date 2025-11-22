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
  // ... (state declarations)

  // We need to wrap the return in a div with p-8 and overflow-y-auto
  // But since I can't easily wrap the entire return without replacing the whole file, 
  // I'll rely on the fact that the component returns a div.
  // I'll check the return statement.

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
      const queryFilters = {
        name: searchTerm,
        ...filters
      };
      // Remove empty filters
      const cleanFilters = Object.fromEntries(
        Object.entries(queryFilters).filter(([_, v]) => v !== '')
      );

      const data = await window.electronAPI.getAllPatients(cleanFilters);
      setPatients(data);
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
    <div className="container mx-auto p-8 max-w-7xl space-y-8 h-full overflow-y-auto">
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
      {
        showFilters && (
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
                  {/* Apply is automatic via useEffect, but button gives feedback */}
                  <Button onClick={() => fetchPatients()} className="flex-1">
                    <Check className="mr-2 h-4 w-4" /> Refresh
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      }

      {/* Stats Overview (Placeholder for now) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card border-none bg-gradient-to-br from-blue-500/10 to-purple-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Total Patients</CardDescription>
            <CardTitle className="text-4xl">{patients.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">Matching current filters</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-none bg-gradient-to-br from-emerald-500/10 to-teal-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Reports Processed</CardDescription>
            <CardTitle className="text-4xl">{patients.reduce((acc, p) => acc + p.reportCount, 0)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">Total for selection</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-none bg-gradient-to-br from-orange-500/10 to-red-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Pending Review</CardDescription>
            <CardTitle className="text-4xl">5</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">Requires attention</div>
          </CardContent>
        </Card>
      </div>

      {/* Patient Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-muted-foreground">Loading patients...</div>
        ) : patients.length === 0 ? (
          <div className="col-span-full text-center py-20 text-muted-foreground">No patients found matching criteria.</div>
        ) : (
          patients.map((patient) => (
            <Card
              key={patient.id}
              className="glass-card group cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 border-muted-foreground/10"
              onClick={() => onPatientSelect(patient.id)}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold leading-none flex items-center gap-2">
                    {patient.name}
                  </CardTitle>
                  <CardDescription className="text-xs font-mono opacity-70">
                    {patient.patientId}
                  </CardDescription>
                </div>
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <User className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 mt-2">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Calendar className="mr-2 h-3 w-3" />
                    <span className="text-xs">DOB: {patient.dob}</span>
                  </div>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Clock className="mr-2 h-3 w-3" />
                    <span className="text-xs">Last: {patient.lastReportDate || 'Never'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70 transition-colors">
                      {patient.reportCount} Reports
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div >
  );
};

export default PatientDashboard;

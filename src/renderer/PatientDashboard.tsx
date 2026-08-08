import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, X, Check, ArrowUpDown, ArrowUp, ArrowDown, ShieldCheck, ShieldAlert, ShieldQuestion, ExternalLink, Info, AlertCircle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { usePatientStore, Patient } from './store/PatientStore';
import { getPatientFlags, daysSinceLastVisit } from './utils/clinicalPriority';
import { getMriCheckUrl } from './utils/mriCheckUrls';
import { cn, formatDate } from '@/lib/utils';
import QrExportButton from '@/components/QrExportButton';

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

interface FilterState {
  dob: string;
  patientId: string;
  hospitalPatientId: string;
  hospitalVisitId: string;
  deviceManufacturer: string;
}

type SortField = 'name' | 'dob' | 'hospitalPatientId' | 'deviceManufacturer' | 'deviceModel' | 'lastReportDate' | 'warningStatus';
type SortDirection = 'asc' | 'desc';

// Rank warning statuses so sorting by the warning column surfaces recalls first.
const WARNING_SORT_ORDER: Record<string, number> = {
  'recall': 0,
  'advisory': 1,
  'manual_check': 2,
  'safe': 3,
};

const getSortValue = (patient: Patient, field: SortField): string => {
  if (field === 'warningStatus') {
    const status = patient.manufacturerWarningStatus?.status || 'unknown';
    return String(WARNING_SORT_ORDER[status] ?? 4);
  }
  return (patient[field] || '').toString().toLowerCase();
};

const EMPTY_FILTERS: FilterState = {
  dob: '',
  patientId: '',
  hospitalPatientId: '',
  hospitalVisitId: '',
  deviceManufacturer: '',
};

// The dashboard unmounts when navigating into a patient profile, so its search
// and filter state would reset on return. Persist it to sessionStorage (cleared
// when the window closes) so returning to the dashboard keeps the same view.
const DASHBOARD_STATE_KEY = 'patientDashboard.searchState.v1';

interface DashboardState {
  searchTerm: string;
  showFilters: boolean;
  sortField: SortField;
  sortDirection: SortDirection;
  filters: FilterState;
}

const loadDashboardState = (): Partial<DashboardState> => {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const PatientDashboard: React.FC<{ onPatientSelect: (patientId: string) => void }> = ({ onPatientSelect }) => {
  const { patients, loading, error, dispatch, fetchPatients } = usePatientStore();

  // Seed from any persisted state once, so the dashboard restores the previous
  // search/filter/sort when the user returns from a patient profile.
  const persisted = React.useRef<Partial<DashboardState>>(undefined as any);
  if (persisted.current === undefined) persisted.current = loadDashboardState();
  const initial = persisted.current;

  const [searchTerm, setSearchTerm] = useState(initial.searchTerm ?? '');
  const [showFilters, setShowFilters] = useState(initial.showFilters ?? false);
  // Sorting
  const [sortField, setSortField] = useState<SortField>(initial.sortField ?? 'name');
  const [sortDirection, setSortDirection] = useState<SortDirection>(initial.sortDirection ?? 'asc');


  const [filters, setFilters] = useState<FilterState>(initial.filters ?? { ...EMPTY_FILTERS });

  // Persist search/filter/sort so it survives the dashboard unmounting on navigation.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        DASHBOARD_STATE_KEY,
        JSON.stringify({ searchTerm, showFilters, sortField, sortDirection, filters }),
      );
    } catch {
      /* storage unavailable — non-fatal, filters just won't persist */
    }
  }, [searchTerm, showFilters, sortField, sortDirection, filters]);

  // Debounced fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPatients();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchPatients]);

  // Listen for patient list updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onPatientListUpdate(() => fetchPatients());
    return () => unsubscribe();
  }, [fetchPatients]);

  // Filter patients
  const filteredPatients = useMemo(() => {
    let filtered = patients;

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(search) ||
        String(p.patientId).toLowerCase().includes(search) ||
        (p.hospitalPatientId && String(p.hospitalPatientId).toLowerCase().includes(search)) ||
        p.id.toLowerCase().includes(search)
      );
    }

    if (filters.dob) filtered = filtered.filter(p => p.dob === filters.dob);
    // XML-sourced IDs can arrive as numbers (fast-xml-parser coerces numeric
    // text), so String() them before calling string methods.
    if (filters.patientId) filtered = filtered.filter(p => String(p.patientId || '').includes(filters.patientId));
    if (filters.hospitalPatientId) filtered = filtered.filter(p => p.hospitalPatientId && String(p.hospitalPatientId).includes(filters.hospitalPatientId));
    if (filters.deviceManufacturer) filtered = filtered.filter(p => p.deviceManufacturer === filters.deviceManufacturer);

    return filtered;
  }, [patients, searchTerm, filters]);

  // Sort patients
  const sortedPatients = useMemo(() => {
    return [...filteredPatients].sort((a, b) => {
      const fieldA = getSortValue(a, sortField);
      const fieldB = getSortValue(b, sortField);
      if (fieldA < fieldB) return sortDirection === 'asc' ? -1 : 1;
      if (fieldA > fieldB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredPatients, sortField, sortDirection]);


  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Shared props so the column headers are keyboard-sortable, not click-only.
  const sortHeaderProps = (field: SortField) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => handleSort(field),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSort(field);
      }
    },
  });

  const clearFilters = () => {
    setFilters({ ...EMPTY_FILTERS });
    setSearchTerm('');
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };


  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30 ml-1" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const getManufacturerLogo = (name?: string) => {
    if (!name) return null;
    const key = Object.keys(MANUFACTURER_LOGOS).find(k => name.toLowerCase().includes(k.toLowerCase()));
    return key ? MANUFACTURER_LOGOS[key] : null;
  };

  const renderPatientCard = (patient: Patient) => {
    const logo = getManufacturerLogo(patient.deviceManufacturer) || unknownLogo;
    const days = daysSinceLastVisit(patient);
    const flags = getPatientFlags(patient);

    return (
      <div
        key={patient.id}
        className="group flex items-center px-5 py-3 bg-card hover:bg-muted border border-transparent hover:border-border rounded-lg transition-all duration-200 cursor-pointer text-sm"
        onClick={() => onPatientSelect(patient.id)}
        role="button"
        tabIndex={0}
        aria-label={`View patient ${patient.name}`}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            onPatientSelect(patient.id);
          }
        }}
      >
        <>
            {/* Patient Column */}
            <div className="w-[25%] flex flex-col justify-center pr-4">
              <span className="font-semibold text-foreground text-[15px] leading-tight group-hover:text-primary transition-colors">
                {patient.name}
              </span>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground/80">
                <span className="font-mono text-xs text-muted-foreground/90">
                  ID: {patient.hospitalPatientId || 'No ID'}
                </span>
              </div>
              {flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {flags.map((flag, i) => (
                    flag.link ? (
                      <button
                        key={i}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(flag.link!); }}
                        title="View manufacturer advisory"
                      >
                        <Info className="h-2.5 w-2.5 shrink-0" />
                        {flag.label}
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </button>
                    ) : (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-muted text-muted-foreground border-border"
                      >
                        <Info className="h-2.5 w-2.5 shrink-0" />
                        {flag.label}
                      </span>
                    )
                  ))}
                </div>
              )}
            </div>

            {/* DOB Column */}
            <div className="w-[10%] text-xs text-muted-foreground flex items-center">
              {formatDate(patient.dob)}
            </div>

            {/* Manufacturer Column (Logo) */}
            <div className="w-[12%] flex justify-center items-center px-1">
              <img
                src={logo}
                alt={patient.deviceManufacturer || 'Unknown'}
                className="h-5 w-auto max-w-full object-contain opacity-90 group-hover:opacity-100 transition-opacity"
              />
            </div>

            {/* Warning Column */}
            <div className="w-[8%] flex justify-center items-center">
              <WarningBadge patient={patient} />
            </div>

            {/* Model + MRI Column */}
            <div className="w-[25%] pr-4">
              <div className="text-xs text-muted-foreground/80 truncate" title={patient.deviceModel}>
                {patient.deviceModel || 'Unknown Model'}
              </div>
              <div className="mt-1">
                <MriBadge patient={patient} />
              </div>
            </div>

            {/* Last Report + Days */}
            <div className="w-[12%] text-sm text-muted-foreground flex items-center gap-2">
              <div className="flex flex-col">
                <span className="text-xs">{patient.lastReportDate ? formatDate(patient.lastReportDate) : 'No reports'}</span>
                {days !== null && (
                  <span className={cn(
                    "text-[10px]",
                    days > 180 ? "text-amber-500" : "text-muted-foreground/60"
                  )}>
                    {days}d ago
                  </span>
                )}
              </div>
              {patient.reportCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 text-[10px] px-1.5 border-primary text-primary bg-primary/10">
                  {patient.reportCount}
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="w-[8%] flex justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <QrExportButton
                patient={patient}
                loadReport={async () => {
                  const visits = await window.electronAPI.getVisitDirectories(patient.id);
                  return visits[0] || null;
                }}
                title="Export latest visit QR for CardioPal onboarding"
                className="h-8 w-8"
              />
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background shadow-none hover:shadow-sm rounded-full"
                onClick={(e) => { e.stopPropagation(); window.electronAPI.openPatientDirectory(patient.id); }}
                title="Open Folder"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
              </Button>
            </div>
        </>
      </div>
    );
  };


  return (
    <div className="container mx-auto pt-2 px-6 pb-2 max-w-7xl space-y-2 h-full flex flex-col overflow-hidden">
      {/* Header Section */}
      <div className="flex flex-col gap-3 shrink-0 pb-2">
        <div className="shrink-0 flex justify-between items-center">
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
        </div>
        <div className="flex items-center gap-2 w-full">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
            <Input
              placeholder="Search patients..."
              className="pl-9 h-9 text-sm bg-background border-input focus:border-primary transition-all w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search patients"
            />
          </div>
          <Button
            variant={showFilters ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-lg border-transparent hover:bg-muted shrink-0"
            onClick={() => setShowFilters(!showFilters)}
            title="Advanced Filters"
            aria-label="Toggle advanced filters"
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card className="glass-card animate-accordion-down overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" /> Advanced Filters
            </CardTitle>
            <CardDescription>Filter patients by specific criteria.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input id="dob" type="date" className="bg-background" value={filters.dob} onChange={(e) => handleFilterChange('dob', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patientId">Patient ID (Internal)</Label>
                <Input id="patientId" placeholder="e.g. P-12345" className="bg-background" value={filters.patientId} onChange={(e) => handleFilterChange('patientId', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hospitalPatientId">Hospital MRN</Label>
                <Input id="hospitalPatientId" placeholder="e.g. MRN-999" className="bg-background" value={filters.hospitalPatientId} onChange={(e) => handleFilterChange('hospitalPatientId', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hospitalVisitId">Visit ID</Label>
                <Input id="hospitalVisitId" placeholder="e.g. V-2023-001" className="bg-background" value={filters.hospitalVisitId} onChange={(e) => handleFilterChange('hospitalVisitId', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manufacturer">Device Manufacturer</Label>
                <Select value={filters.deviceManufacturer} onValueChange={(value) => handleFilterChange('deviceManufacturer', value)}>
                  <SelectTrigger id="manufacturer" className="bg-background">
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
                <Button variant="outline" onClick={clearFilters} className="flex-1"><X className="mr-2 h-4 w-4" /> Clear</Button>
                <Button onClick={() => fetchPatients()} className="flex-1"><Check className="mr-2 h-4 w-4" /> Refresh</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Patient List */}
      <div className="flex flex-col flex-1 min-h-0 gap-1 rounded-xl bg-background border border-transparent overflow-hidden">
        {/* Header Row */}
        <div className="flex items-center px-6 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted rounded-lg mb-0 select-none shrink-0 z-10">
          <div className="w-[25%] flex items-center cursor-pointer hover:text-foreground transition-colors" {...sortHeaderProps('name')}>
            Patient <SortIcon field="name" />
          </div>
          <div className="w-[10%] flex items-center cursor-pointer hover:text-foreground transition-colors" {...sortHeaderProps('dob')}>
            DOB <SortIcon field="dob" />
          </div>
          <div className="w-[12%] flex items-center cursor-pointer hover:text-foreground transition-colors justify-center" {...sortHeaderProps('deviceManufacturer')}>
            <SortIcon field="deviceManufacturer" />
            <span className="sr-only">Manufacturer</span>
          </div>
          <div className="w-[8%] flex justify-center cursor-pointer group" {...sortHeaderProps('warningStatus')}>
            <ShieldAlert className="h-4 w-4 opacity-50 group-hover:opacity-100" />
            <SortIcon field="warningStatus" />
            <span className="sr-only">Warning Status</span>
          </div>
          <div className="w-[25%] flex items-center cursor-pointer hover:text-foreground transition-colors" {...sortHeaderProps('deviceModel')}>
            Model <SortIcon field="deviceModel" />
          </div>
          <div className="w-[12%] flex items-center cursor-pointer hover:text-foreground transition-colors" {...sortHeaderProps('lastReportDate')}>
            Last Report <SortIcon field="lastReportDate" />
          </div>
          <div className="w-[8%] text-right"></div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pb-4 pr-1 scrollbar-thin scrollbar-thumb-muted-foreground/10 hover:scrollbar-thumb-muted-foreground/20">
          {loading && patients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-muted-foreground/50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary/30"></div>
              <p className="text-sm">Loading patients...</p>
            </div>
          ) : error && patients.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-red-500/30 rounded-xl bg-red-500/5" role="alert">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500/60" />
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">The patient list could not be loaded from the data directory.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchPatients()}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : sortedPatients.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground/60 border-2 border-dashed border-muted rounded-xl bg-muted">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p>No patients found matching criteria.</p>
            </div>
          ) : (
            <div className="space-y-1 pb-2">
              {sortedPatients.map(renderPatientCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Sub-components ---

const WarningBadge: React.FC<{ patient: Patient }> = ({ patient }) => {
  const status = patient.manufacturerWarningStatus?.status || 'unknown';
  const details = patient.manufacturerWarningStatus?.details || 'Status Unknown';
  const link = patient.manufacturerWarningStatus?.link;

  const openLink = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (link && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(link);
    }
  };

  const keyboardProps = link
    ? {
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLink(e);
        }
      },
    }
    : {};

  if (status === 'safe') {
    return (
      <div className="text-green-500 cursor-help" title={`Safe: ${details}`} role="img" aria-label="Safe">
        <ShieldCheck className="h-5 w-5" />
      </div>
    );
  }
  if (status === 'advisory' || status === 'recall') {
    return (
      <div className="text-red-500 cursor-pointer animate-pulse" title={`WARNING: ${details}`} onClick={openLink} role="button" aria-label="Warning active" {...keyboardProps}>
        <ShieldAlert className="h-5 w-5" />
      </div>
    );
  }
  if (status === 'manual_check') {
    return (
      <div className="text-gray-400 cursor-pointer hover:text-gray-600" title={`Manual Check Required: ${details}`} onClick={openLink} role="button" aria-label="Manual check required" {...keyboardProps}>
        <ShieldQuestion className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="text-muted-foreground/30" title="Warning Status Unknown" aria-label="Unknown warning status">
      <ShieldQuestion className="h-4 w-4" />
    </div>
  );
};

const MriBadge: React.FC<{ patient: Patient }> = ({ patient }) => {
  const manu = patient.deviceManufacturer || '';
  const url = getMriCheckUrl(manu);

  const openMriCheck = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (url && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    }
  };

  if (!manu || manu.toLowerCase() === 'unknown') {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md border font-medium transition-colors shadow-sm bg-muted text-foreground border-border",
        url ? "cursor-pointer hover:bg-accent" : "opacity-60 cursor-default"
      )}
      title={url ? `Open ${manu} MRI compatibility check in browser` : 'No MRI check resource available for this manufacturer'}
      onClick={url ? openMriCheck : undefined}
      role={url ? 'button' : undefined}
      tabIndex={url ? 0 : undefined}
      onKeyDown={url ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMriCheck(e);
        }
      } : undefined}
      aria-label="Check MRI compatibility"
    >
      <ExternalLink className="h-3 w-3" /> Check MRI
    </div>
  );
};

export default PatientDashboard;

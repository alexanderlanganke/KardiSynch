import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, GitMerge, RefreshCw, ChevronDown, ChevronRight, Search, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAppDialog } from '@/renderer/components/AppDialogProvider';
import type { PatientDupGroup, PatientSummary, DupTier } from '@/renderer/electron';

interface PatientMergeModalProps {
  open: boolean;
  onClose: () => void;
}

// Tier presentation: label + badge colour. Ordered strongest → weakest.
const TIER_META: Record<DupTier, { label: string; className: string; autoSelect: boolean; collapsed: boolean }> = {
  'exact': { label: 'Exact match', className: 'text-red-600 border-red-200 bg-red-500/5', autoSelect: true, collapsed: false },
  'serial': { label: 'Shared device', className: 'text-red-600 border-red-200 bg-red-500/5', autoSelect: true, collapsed: false },
  'dob-fuzzy-name': { label: 'Probable', className: 'text-orange-600 border-orange-200 bg-orange-500/5', autoSelect: false, collapsed: false },
  'name-close-dob': { label: 'Probable', className: 'text-orange-600 border-orange-200 bg-orange-500/5', autoSelect: false, collapsed: false },
  'name-only': { label: 'Weak (same surname)', className: 'text-muted-foreground border-border', autoSelect: false, collapsed: true },
};

const patientLabel = (p: PatientSummary) =>
  `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';

/** Suggested keeper = most reports, tie broken by having a hospital patient ID. */
function pickDefaultKeeper(patients: PatientSummary[]): string {
  const sorted = [...patients].sort((a, b) => {
    if (b.reportCount !== a.reportCount) return b.reportCount - a.reportCount;
    return (b.hospitalPatientId ? 1 : 0) - (a.hospitalPatientId ? 1 : 0);
  });
  return sorted[0]?.id;
}

interface GroupState {
  keeperId: string;
  selectedLosers: Set<string>;
  collapsed: boolean;
}

const PatientCard: React.FC<{
  p: PatientSummary;
  isKeeper: boolean;
  isSelected: boolean;
  groupName: string;
  onKeeper: () => void;
  onToggle: () => void;
}> = ({ p, isKeeper, isSelected, groupName, onKeeper, onToggle }) => (
  <div className={`flex items-center gap-3 rounded-md border p-2 text-sm ${isKeeper ? 'border-primary bg-primary/5' : 'border-border'}`}>
    <label className="flex items-center gap-1 cursor-pointer" title="Keep this record">
      <input type="radio" name={`keeper-${groupName}`} checked={isKeeper} onChange={onKeeper} className="h-4 w-4 text-primary" />
      <span className="text-xs text-muted-foreground">Keep</span>
    </label>
    <label className={`flex items-center gap-1 ${isKeeper ? 'opacity-30' : 'cursor-pointer'}`} title="Merge this record into the kept one">
      <input type="checkbox" checked={isSelected} disabled={isKeeper} onChange={onToggle} className="h-4 w-4 rounded text-primary" />
      <span className="text-xs text-muted-foreground">Merge</span>
    </label>
    <div className="flex-1 min-w-0">
      <div className="font-medium truncate">
        {patientLabel(p)}
        {isKeeper && <Badge variant="outline" className="ml-2 text-[10px] text-primary border-primary/40">Keeper</Badge>}
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
        <span>DOB: {formatDate(p.dob) || '—'}</span>
        {p.hospitalPatientId && <span>ID: {p.hospitalPatientId}</span>}
        <span>{p.reportCount} visit{p.reportCount === 1 ? '' : 's'}</span>
        {p.lastReportDate && <span>Last: {formatDate(p.lastReportDate)}</span>}
      </div>
      {p.serials.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground truncate">Serials: {p.serials.join(', ')}</div>
      )}
    </div>
  </div>
);

const PatientMergeModal: React.FC<PatientMergeModalProps> = ({ open, onClose }) => {
  const { showAlert, showConfirm } = useAppDialog();
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [groups, setGroups] = useState<PatientDupGroup[]>([]);
  const [groupState, setGroupState] = useState<Record<number, GroupState>>({});

  // Manual merge state
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [manualSelected, setManualSelected] = useState<PatientSummary[]>([]);
  const [manualKeeperId, setManualKeeperId] = useState<string>('');

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const found = await window.electronAPI.findDuplicatePatients();
      setGroups(found);
      const initial: Record<number, GroupState> = {};
      found.forEach((g, i) => {
        const keeperId = pickDefaultKeeper(g.patients);
        const meta = TIER_META[g.tier];
        initial[i] = {
          keeperId,
          selectedLosers: new Set(meta.autoSelect ? g.patients.filter(p => p.id !== keeperId).map(p => p.id) : []),
          collapsed: meta.collapsed,
        };
      });
      setGroupState(initial);
    } catch (e) {
      await showAlert('Failed to scan for duplicate patients.');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    if (open) {
      setGroups([]);
      setGroupState({});
      setManualSelected([]);
      setManualKeeperId('');
      setSearch('');
      setSearchResults([]);
      scan();
    }
  }, [open, scan]);

  const updateGroup = (idx: number, patch: Partial<GroupState>) => {
    setGroupState(prev => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  };

  const setKeeper = (idx: number, keeperId: string) => {
    const st = groupState[idx];
    const nextLosers = new Set(st.selectedLosers);
    nextLosers.delete(keeperId); // the keeper can't also be a loser
    updateGroup(idx, { keeperId, selectedLosers: nextLosers });
  };

  const toggleLoser = (idx: number, id: string) => {
    const st = groupState[idx];
    const next = new Set(st.selectedLosers);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateGroup(idx, { selectedLosers: next });
  };

  const runMerge = async (keeperId: string, loserIds: string[], keeperName: string, onDone: () => void) => {
    if (!keeperId || loserIds.length === 0) return;
    const ok = await showConfirm(
      `Merge ${loserIds.length} patient record${loserIds.length === 1 ? '' : 's'} into "${keeperName}"?\n\n` +
      `All visits will be moved to the kept record and the ${loserIds.length === 1 ? 'other record' : 'other records'} will be permanently deleted. This cannot be undone.`
    );
    if (!ok) return;
    setMerging(true);
    try {
      const res = await window.electronAPI.mergePatients(keeperId, loserIds);
      let msg = `Merge complete.\nMoved ${res.reportsMoved} visit${res.reportsMoved === 1 ? '' : 's'}.\nDeleted ${res.patientsDeleted} patient record${res.patientsDeleted === 1 ? '' : 's'}.`;
      if (res.errors.length) msg += `\n\nWarnings:\n${res.errors.join('\n')}`;
      await showAlert(msg);
      onDone();
    } catch (e) {
      await showAlert('Failed to merge patients.');
    } finally {
      setMerging(false);
    }
  };

  const mergeGroup = async (idx: number) => {
    const g = groups[idx];
    const st = groupState[idx];
    const keeper = g.patients.find(p => p.id === st.keeperId);
    const loserIds = [...st.selectedLosers].filter(id => id !== st.keeperId);
    await runMerge(st.keeperId, loserIds, keeper ? patientLabel(keeper) : 'kept record', () => {
      // Drop the merged group from the list (indices stay stable; we filter by ref).
      setGroups(prev => prev.filter((_, i) => i !== idx));
      setGroupState(prev => {
        const next: Record<number, GroupState> = {};
        Object.entries(prev).forEach(([k, v]) => {
          const ki = Number(k);
          if (ki < idx) next[ki] = v;
          else if (ki > idx) next[ki - 1] = v;
        });
        return next;
      });
    });
  };

  const dismissGroup = (idx: number) => {
    setGroups(prev => prev.filter((_, i) => i !== idx));
    setGroupState(prev => {
      const next: Record<number, GroupState> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      });
      return next;
    });
  };

  // ---- Manual merge ----
  const doSearch = async (q: string) => {
    setSearch(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const results = await window.electronAPI.getAllPatients({ name: q.trim() });
      setSearchResults(results);
    } catch { setSearchResults([]); }
  };

  const toggleManual = (patient: any) => {
    const summary: PatientSummary = {
      id: patient.id,
      first_name: (patient.name || '').split(' ').slice(0, -1).join(' ') || patient.name || null,
      last_name: (patient.name || '').split(' ').slice(-1)[0] || null,
      dob: patient.dob || null,
      hospitalPatientId: patient.hospitalPatientId || null,
      reportCount: patient.reportCount || 0,
      lastReportDate: patient.lastReportDate || null,
      serials: [],
    };
    setManualSelected(prev => {
      const exists = prev.some(p => p.id === summary.id);
      const next = exists ? prev.filter(p => p.id !== summary.id) : [...prev, summary];
      if (!next.some(p => p.id === manualKeeperId)) setManualKeeperId(next[0]?.id || '');
      return next;
    });
  };

  const mergeManual = async () => {
    const keeper = manualSelected.find(p => p.id === manualKeeperId);
    const loserIds = manualSelected.filter(p => p.id !== manualKeeperId).map(p => p.id);
    await runMerge(manualKeeperId, loserIds, keeper ? patientLabel(keeper) : 'kept record', () => {
      setManualSelected([]);
      setManualKeeperId('');
      setSearch('');
      setSearchResults([]);
      scan();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !merging && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Merge Duplicate Patients
          </DialogTitle>
          <DialogDescription>
            Find duplicate or probable-duplicate patient records and merge them. Merging moves all visits to the kept
            record, then permanently deletes the others.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="detected" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="detected">Detected {groups.length > 0 && `(${groups.length})`}</TabsTrigger>
            <TabsTrigger value="manual">Manual merge</TabsTrigger>
          </TabsList>

          {/* ---- Detected duplicates ---- */}
          <TabsContent value="detected">
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="sm" onClick={scan} disabled={loading || merging}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Rescan
              </Button>
            </div>
            <ScrollArea className="h-[50vh] pr-3">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Scanning for duplicates…
                </div>
              ) : groups.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">No duplicate patients found.</div>
              ) : (
                <div className="space-y-3">
                  {groups.map((g, idx) => {
                    const st = groupState[idx];
                    if (!st) return null;
                    const meta = TIER_META[g.tier];
                    const loserCount = [...st.selectedLosers].filter(id => id !== st.keeperId).length;
                    return (
                      <div key={idx} className={`rounded-lg border p-3 ${meta.className}`}>
                        <div className="flex items-center justify-between mb-2">
                          <button
                            className="flex items-center gap-2 text-left"
                            onClick={() => updateGroup(idx, { collapsed: !st.collapsed })}
                          >
                            {st.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                            <span className="text-sm text-muted-foreground">{g.reason}</span>
                            <span className="text-xs text-muted-foreground">· {g.patients.length} records</span>
                          </button>
                        </div>
                        {!st.collapsed && (
                          <>
                            <div className="space-y-2">
                              {g.patients.map(p => (
                                <PatientCard
                                  key={p.id}
                                  p={p}
                                  groupName={String(idx)}
                                  isKeeper={st.keeperId === p.id}
                                  isSelected={st.selectedLosers.has(p.id)}
                                  onKeeper={() => setKeeper(idx, p.id)}
                                  onToggle={() => toggleLoser(idx, p.id)}
                                />
                              ))}
                            </div>
                            <div className="flex justify-end gap-2 mt-3">
                              <Button variant="ghost" size="sm" onClick={() => dismissGroup(idx)} disabled={merging}>
                                Dismiss
                              </Button>
                              <Button size="sm" onClick={() => mergeGroup(idx)} disabled={merging || loserCount === 0}>
                                <GitMerge className="mr-2 h-4 w-4" /> Merge {loserCount > 0 ? `${loserCount} →` : ''}
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* ---- Manual merge ---- */}
          <TabsContent value="manual">
            <div className="relative mb-3">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search patients by name…"
                value={search}
                onChange={(e) => doSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[30vh] pr-3 mb-3">
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {search ? 'No matches.' : 'Search to select patients to merge.'}
                </div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map(p => {
                    const selected = manualSelected.some(m => m.id === p.id);
                    return (
                      <label key={p.id} className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleManual(p)} className="h-4 w-4 rounded text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground flex gap-3">
                            <span>DOB: {formatDate(p.dob) || '—'}</span>
                            {p.hospitalPatientId && <span>ID: {p.hospitalPatientId}</span>}
                            <span>{p.reportCount} visits</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            {manualSelected.length >= 2 && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">Choose the record to keep:</div>
                {manualSelected.map(p => (
                  <PatientCard
                    key={p.id}
                    p={p}
                    groupName="manual"
                    isKeeper={manualKeeperId === p.id}
                    isSelected={manualKeeperId !== p.id}
                    onKeeper={() => setManualKeeperId(p.id)}
                    onToggle={() => toggleManual(p)}
                  />
                ))}
                <div className="flex justify-end">
                  <Button size="sm" onClick={mergeManual} disabled={merging || !manualKeeperId}>
                    <GitMerge className="mr-2 h-4 w-4" /> Merge {manualSelected.length - 1} into keeper
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merging}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PatientMergeModal;

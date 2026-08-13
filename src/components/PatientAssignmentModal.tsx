import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, FileText, AlertCircle, AlertTriangle, ArrowRight, FolderInput, Copy, Check, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDate } from '@/lib/utils';
import ReportViewer from './ReportViewer';
import { useAppDialog } from '@/renderer/components/AppDialogProvider';

interface Patient {
    id: string;
    patientId: string;
    name: string;
    dob: string;
}

// One selectable/previewable file within the sorting dialog. Normalized from
// `sourceItem` below so a single-file legacy caller (ImportHistory's "move
// file" flow, a remote Web Panel download) and the batched pending-sort queue
// (issue #158) share one rendering path.
interface FileEntry {
    key: string;           // unique within this dialog instance: `${taskId||'na'}::${file}`
    taskId?: string;       // originating pending-sort task, when applicable
    file: string;          // basename
    filePath?: string;     // absolute path for preview
    previewData: any;
    isIntraop?: boolean;
}

interface PatientAssignmentModalProps {
    open: boolean;
    mode: 'import' | 'move';
    sourceItem: any; // FileInfo (import) or VisitInfo (move)
    // In move mode, the patient the visit is currently filed under — offering
    // it as a move target would be a confusing no-op (or, if a different
    // visit slot were picked, a pointless same-patient shuffle).
    excludePatientId?: string;
    onResolve: (decision: any) => void;
    onCancel: () => void;
}

const getFileType = (filename: string): 'xml' | 'pdf' | 'text' => {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.xml')) return 'xml';
    if (lower.endsWith('.pdf')) return 'pdf';
    return 'text';
};

// Normalized identity used to flag likely-duplicate files within the same
// batch (issue #157 — a programmer re-exporting its raw-data file more than
// once). Deliberately excludes files with no serial on either side, since an
// empty match there would be noise rather than signal.
const duplicateIdentity = (previewData: any): string | null => {
    const serial = previewData?.serial;
    if (!serial || serial === 'Unknown') return null;
    const name = String(previewData?.patientName || '').trim().toLowerCase();
    const dob = previewData?.dob || '';
    const date = (previewData?.date || '').split('T')[0];
    return `${name}|${dob}|${date}|${serial}`;
};

const PatientAssignmentModal: React.FC<PatientAssignmentModalProps> = ({ open, mode, sourceItem, excludePatientId, onResolve, onCancel }) => {
    const { showAlert, showConfirm } = useAppDialog();
    const [activeTab, setActiveTab] = useState('existing');
    const [searchTerm, setSearchTerm] = useState('');
    const [patients, setPatients] = useState<Patient[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

    const [visits, setVisits] = useState<any[]>([]);
    const [visitMode, setVisitMode] = useState<'existing' | 'new'>('existing');
    const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
    const [newVisitDate, setNewVisitDate] = useState('');

    // New Patient Form
    const [newPatient, setNewPatient] = useState({
        first_name: '',
        last_name: '',
        dob: '',
        hospitalPatientId: ''
    });

    // Track previous source item to prevent unnecessary resets
    const [prevSourceItemJson, setPrevSourceItemJson] = useState<string>('');

    // Files available for this sorting pass, and which of them are currently
    // checked to be included in the confirm action (issue #158: select/
    // deselect individual files within a batched pending-sort task).
    const fileEntries: FileEntry[] = useMemo(() => {
        if (mode !== 'import' || !sourceItem) return [];
        if (Array.isArray(sourceItem.files) && sourceItem.files.length > 0) {
            return sourceItem.files.map((f: any) => ({
                key: `${f.taskId || 'na'}::${f.file}`,
                taskId: f.taskId,
                file: f.file,
                filePath: f.filePath,
                previewData: f.previewData || {},
                isIntraop: f.isIntraop,
            }));
        }
        // Legacy single-file callers (ImportHistory "move file", remote Web
        // Panel download assignment) don't build a `files` array — synthesize
        // a single entry so the same rendering path covers them.
        if (sourceItem.filename) {
            return [{
                key: `${sourceItem.taskIds?.[0] || 'na'}::${sourceItem.filename}`,
                taskId: sourceItem.taskIds?.[0],
                file: sourceItem.filename,
                filePath: sourceItem.tempPath,
                previewData: sourceItem.previewData || {},
            }];
        }
        return [];
    }, [sourceItem, mode]);

    const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
    const [activeKey, setActiveKey] = useState<string>('');
    const [selectedPatientRecord, setSelectedPatientRecord] = useState<any | null>(null);

    const activeEntry = fileEntries.find(f => f.key === activeKey) || fileEntries[0];

    // Files sharing the same normalized patient/date/serial identity are
    // flagged as possible duplicates so the user can spot (and deselect) a
    // repeated export instead of importing it twice.
    const duplicateKeys = useMemo(() => {
        const byIdentity = new Map<string, string[]>();
        for (const f of fileEntries) {
            const id = duplicateIdentity(f.previewData);
            if (!id) continue;
            const list = byIdentity.get(id) || [];
            list.push(f.key);
            byIdentity.set(id, list);
        }
        const flagged = new Set<string>();
        for (const list of byIdentity.values()) {
            if (list.length > 1) list.forEach(k => flagged.add(k));
        }
        return flagged;
    }, [fileEntries]);

    useEffect(() => {
        if (open && sourceItem) {
            const currentJson = JSON.stringify(sourceItem);
            if (currentJson === prevSourceItemJson) return; // Skip if content hasn't changed
            setPrevSourceItemJson(currentJson);

            // A different source item means a fresh sorting decision — drop the
            // previous file's selection so a reflexive confirm can't assign the
            // new document to the previously chosen patient/visit. When the
            // import gate flagged a likely existing patient (generator change /
            // spelling variant, issue #143), preselect that candidate.
            const entries: FileEntry[] = Array.isArray(sourceItem.files) && sourceItem.files.length > 0
                ? sourceItem.files
                : (sourceItem.filename ? [{ key: '', file: sourceItem.filename, previewData: sourceItem.previewData || {} }] : []);
            const firstPreview = entries[0]?.previewData || {};

            setSelectedPatientId((mode === 'import' && firstPreview?.suggestedPatientId) || null);
            setSelectedVisitId(null);
            setSearchTerm('');
            setActiveTab('existing');
            setVisitMode('existing');
            setCheckedKeys(new Set(fileEntries.map(f => f.key)));
            setActiveKey(fileEntries[0]?.key || '');

            // Pre-fill form from the first file's preview data
            if (mode === 'import' && firstPreview) {
                const { patientName, dob, date } = firstPreview;
                let first = '';
                let last = '';

                if (patientName && patientName !== 'Unknown Unknown') {
                    const parts = patientName.trim().split(/\s+/);
                    if (parts.length > 1) {
                        last = parts.pop() || '';
                        first = parts.join(' ');
                    } else {
                        last = parts[0] || '';
                        first = '';
                    }
                }

                setNewPatient({
                    first_name: first,
                    last_name: last,
                    dob: dob || '',
                    hospitalPatientId: ''
                });

                if (date) setNewVisitDate(date.split('T')[0]);
            } else if (mode === 'move') {
                // Move Mode: sourceItem is Visit object
                if (sourceItem.interrogation_date) {
                    setNewVisitDate(sourceItem.interrogation_date.split('T')[0]);
                }
            }

            // Load patients for search
            window.electronAPI.getPatientDirectories().then((data: any[]) => {
                setPatients(data);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sourceItem, mode, prevSourceItemJson]);

    // Fetch visits when patient selected (Only relevant for Import mode)
    useEffect(() => {
        if (selectedPatientId && mode === 'import') {
            window.electronAPI.getVisitDirectories(selectedPatientId).then((visitsData) => {
                const safeVisits = Array.isArray(visitsData) ? visitsData : [];
                setVisits(safeVisits);
                // No visits to pick from -> default straight to "Create New Visit"
                // so Confirm isn't blocked on an impossible selection.
                setVisitMode(safeVisits.length > 0 ? 'existing' : 'new');
            });
            setSelectedVisitId(null);
        } else {
            setVisits([]);
        }
    }, [selectedPatientId, mode]);

    // Fetch the selected patient's current record for the comparison panel
    // (issue #158: "show the current values of the chosen patient... compare
    // these to the to-be-imported values").
    useEffect(() => {
        if (selectedPatientId && mode === 'import') {
            window.electronAPI.getPatientById(selectedPatientId).then((data: any) => {
                setSelectedPatientRecord(data || null);
            }).catch(() => setSelectedPatientRecord(null));
        } else {
            setSelectedPatientRecord(null);
        }
    }, [selectedPatientId, mode]);

    const filteredPatients = patients.filter(p =>
        p.id !== excludePatientId &&
        (String(p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(p.patientId || '').toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const toggleFileChecked = (key: string) => {
        setCheckedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Group the checked files by their originating task for resolvePendingSortTasks
    // (issue #158). Legacy single-file callers have no taskId — those flows
    // don't consult fileSelection, so it's simply omitted for them.
    const buildFileSelection = (): Record<string, string[]> | undefined => {
        if (mode !== 'import' || fileEntries.length === 0) return undefined;
        const bySource: Record<string, string[]> = {};
        let hasTaskId = false;
        for (const f of fileEntries) {
            if (!checkedKeys.has(f.key) || !f.taskId) continue;
            hasTaskId = true;
            (bySource[f.taskId] ||= []).push(f.file);
        }
        return hasTaskId ? bySource : undefined;
    };

    const handleConfirm = () => {
        if (selectedPatientId) {
            if (mode === 'import' && checkedKeys.size === 0) {
                showAlert('Select at least one file to assign.');
                return;
            }
            // Validate "Create New Visit" date
            if (mode === 'import' && visitMode === 'new' && !newVisitDate) {
                showAlert('Please specify a date for the new visit.');
                return;
            }
            // Guard: assigning to an existing visit requires one to be selected.
            if (mode === 'import' && visitMode === 'existing' && !selectedVisitId) {
                showAlert('Please select a visit, or choose "Create New Visit".');
                return;
            }

            if (mode === 'import') {
                onResolve({
                    action: 'assign-patient',
                    patientId: selectedPatientId,
                    visitMode,
                    visitId: visitMode === 'existing' ? selectedVisitId : undefined,
                    visitDate: visitMode === 'new' ? newVisitDate : undefined,
                    fileSelection: buildFileSelection()
                });
            } else {
                // Move Mode: Just return the target patient ID
                onResolve({
                    action: 'move-visit',
                    targetPatientId: selectedPatientId
                });
            }
        }
    };

    const handleCreate = () => {
        if (!newPatient.last_name || !newPatient.dob) {
            showAlert('Please fill in required patient fields (Last Name, DOB).');
            return;
        }

        if (mode === 'import' && !newVisitDate) {
            showAlert('Please specify a Visit Date.');
            return;
        }
        if (mode === 'import' && checkedKeys.size === 0) {
            showAlert('Select at least one file to assign.');
            return;
        }

        onResolve({
            action: 'create-patient',
            patientData: newPatient,
            visitDate: newVisitDate, // Used for Import to create visit, for Move it might be unused but passed
            fileSelection: buildFileSelection()
        });
    };

    const handleUnmatched = () => {
        // For queued (pending) items, "skip" becomes "move the whole task to the
        // unmatched dir" (issue #136); otherwise keep the legacy unmatched action.
        onResolve({ action: sourceItem?.source === 'pending' ? 'move-unmatched' : 'unmatched' });
    };

    if (!sourceItem) return null;

    // Dismissing via ESC / overlay / X must never silently file the document as
    // unmatched: pending items just defer, everything else asks first. The
    // explicit "Skip this file" button remains the intentional path.
    const handleDismissAttempt = async () => {
        if (mode === 'import' && sourceItem?.source !== 'pending') {
            const ok = await showConfirm(
                'Close without assigning this document? It will be filed as unmatched.\n\nChoose Cancel to keep sorting.',
                'Discard sorting?'
            );
            if (!ok) return; // keep the dialog open
        }
        onCancel();
    };

    const checkedCount = checkedKeys.size;
    const totalCount = fileEntries.length;

    // Compare the currently-previewed file's parsed values against the
    // selected patient's current stored record (issue #158). Read-only — this
    // is a confirm-you-picked-the-right-patient aid, not a merge tool.
    const currentDevices = selectedPatientRecord?.devices || [];
    const incomingSerial = activeEntry?.previewData?.serial;
    const serialKnown = incomingSerial && incomingSerial !== 'Unknown';
    const serialMatches = serialKnown && currentDevices.length > 0
        ? currentDevices.some((d: any) => d.serial === incomingSerial)
        : null; // null = not enough data to judge

    return (
        <Dialog open={open} onOpenChange={(val) => !val && handleDismissAttempt()}>
            <DialogContent
                className="max-w-[95vw] w-[1400px] h-[90vh] max-h-[90vh] flex flex-col bg-background border-border p-0 overflow-hidden shadow-2xl rounded-xl"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="flex flex-col h-full overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-5 border-b bg-background relative shrink-0">
                        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent"></div>
                        <DialogTitle className="flex items-center gap-3 text-2xl font-light tracking-tight">
                            <div className={`p-2 rounded-full ring-1 ${mode === 'import' ? 'bg-orange-100 ring-orange-200 dark:bg-orange-500/20 dark:ring-orange-500/30' : 'bg-blue-100 ring-blue-200 dark:bg-blue-500/20 dark:ring-blue-500/30'}`}>
                                {mode === 'import' ? <AlertCircle className="h-6 w-6 text-orange-500" /> : <FolderInput className="h-6 w-6 text-blue-500" />}
                            </div>
                            <div className="flex flex-col">
                                <span className="flex items-center gap-2">
                                    {mode === 'import'
                                        ? (totalCount > 1 ? `Sort ${totalCount} Files` : 'Manual Sorting Required')
                                        : 'Move Visit to Patient'}
                                </span>
                                <span className="text-sm font-normal text-muted-foreground mt-0.5">
                                    {mode === 'import'
                                        ? (totalCount > 1
                                            ? `${checkedCount} of ${totalCount} selected — identify the patient for the checked file(s).`
                                            : 'Please identify the patient for this document.')
                                        : 'Select the correct patient to move this visit to.'}
                                </span>
                            </div>
                        </DialogTitle>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0 bg-muted min-h-0">

                        {/* LEFT PANE: Controls (4 columns) */}
                        <div className="col-span-4 border-r bg-background flex flex-col h-full min-h-0 overflow-hidden shadow-xl z-10">
                            <ScrollArea className="flex-1 min-h-0">
                                <div className="p-6 space-y-8">
                                    {/* Info Card */}
                                    <div className="bg-card rounded-xl border p-4 shadow-sm relative overflow-hidden group">
                                        <div className="relative z-10 space-y-4">
                                            {mode === 'import' ? (
                                                <>
                                                    {/* File list — one row per file in this batch, selectable for
                                                        preview and checkable for inclusion (issue #158). */}
                                                    <div className="space-y-1.5">
                                                        {fileEntries.map(f => {
                                                            const isDup = duplicateKeys.has(f.key);
                                                            return (
                                                                <div
                                                                    key={f.key}
                                                                    onClick={() => setActiveKey(f.key)}
                                                                    className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-all ${activeKey === f.key ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'}`}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        className="h-3.5 w-3.5 mt-0.5 accent-primary cursor-pointer shrink-0"
                                                                        checked={checkedKeys.has(f.key)}
                                                                        onClick={e => e.stopPropagation()}
                                                                        onChange={() => toggleFileChecked(f.key)}
                                                                        aria-label={`Include ${f.file}`}
                                                                    />
                                                                    <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="text-xs font-medium break-all leading-tight">{f.file}</p>
                                                                        <p className="text-[10px] text-muted-foreground truncate">
                                                                            {f.previewData?.patientName || 'Unknown'}
                                                                            {f.previewData?.serial && f.previewData.serial !== 'Unknown' ? ` · ${f.previewData.serial}` : ''}
                                                                        </p>
                                                                        {isDup && (
                                                                            <Badge variant="outline" className="mt-1 text-[9px] h-4 px-1 gap-1 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-500/30 dark:bg-amber-500/10">
                                                                                <Copy className="h-2.5 w-2.5" /> Possible duplicate
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {activeEntry?.previewData?.note && (
                                                        <div className="flex items-start gap-2 rounded-md bg-amber-100 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                                            <span>{activeEntry.previewData.note}</span>
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 bg-muted -mx-4 -mb-4 p-4 border-t">
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Name</span>
                                                            <p className="font-medium truncate">{activeEntry?.previewData?.patientName || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Serial</span>
                                                            <p className="font-mono text-xs">{activeEntry?.previewData?.serial || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Manufacturer</span>
                                                            <p className="font-medium truncate">{activeEntry?.previewData?.manufacturer || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Model</span>
                                                            <p className="text-xs truncate">{activeEntry?.previewData?.deviceModel || 'Unknown'}</p>
                                                        </div>
                                                        {activeEntry?.previewData?.leads && activeEntry.previewData.leads.length > 0 && (
                                                            <div className="col-span-2 border-t pt-2 mt-2">
                                                                <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Leads</span>
                                                                <div className="space-y-1">
                                                                    {activeEntry.previewData.leads.map((l: any, i: number) => (
                                                                        <div key={i} className="text-xs flex justify-between">
                                                                            <span className="text-muted-foreground">{l.name || 'Lead'}:</span>
                                                                            <span className="font-mono">{l.model} ({l.serial})</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <h3 className="font-semibold text-lg">Visit Selection</h3>
                                                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 bg-muted -mx-4 -mb-4 p-4 border-t">
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Date</span>
                                                            <p className="font-medium">{formatDate(sourceItem.interrogation_date)}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Files</span>
                                                            <p className="font-mono text-xs">{sourceItem.fileCount || 0} files</p>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Area */}
                                    <div className="space-y-4">
                                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                            <TabsList className="grid w-full grid-cols-2 h-11 p-1 bg-muted">
                                                <TabsTrigger value="existing">Find Existing</TabsTrigger>
                                                <TabsTrigger value="new">Create New</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="existing" className="space-y-4 pt-4">
                                                <div className="space-y-3">
                                                    <div className="relative">
                                                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input
                                                            placeholder="Search patients..."
                                                            className="pl-9"
                                                            value={searchTerm}
                                                            onChange={e => setSearchTerm(e.target.value)}
                                                        />
                                                    </div>

                                                    {/* Patient List */}
                                                    <div className="border rounded-lg bg-card shadow-inner overflow-hidden flex flex-col h-[220px]">
                                                        <div className="flex-1 overflow-y-auto p-1 space-y-1">
                                                            {filteredPatients.length === 0 && (
                                                                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-xs px-4">
                                                                    <Search className="h-5 w-5 mb-2 opacity-30" />
                                                                    <p>{searchTerm ? 'No matches for this search.' : 'No patients found.'}</p>
                                                                    <p className="mt-1 opacity-70">Try the "Create New" tab to add this patient.</p>
                                                                </div>
                                                            )}
                                                            {filteredPatients.map(p => (
                                                                <div
                                                                    key={p.id}
                                                                    onClick={() => setSelectedPatientId(p.id)}
                                                                    className={`flex items-center justify-between p-3 rounded-md cursor-pointer transition-all border ${selectedPatientId === p.id
                                                                        ? 'bg-primary/10 border-primary shadow-sm'
                                                                        : 'hover:bg-muted/50 border-transparent'
                                                                        }`}
                                                                >
                                                                    <div className="min-w-0 pr-2">
                                                                        <p className={`font-medium text-sm truncate ${selectedPatientId === p.id ? 'text-primary' : ''}`}>{p.name}</p>
                                                                        <p className="text-xs opacity-70 truncate flex items-center gap-1.5 mt-0.5">
                                                                            <span>{formatDate(p.dob)}</span>
                                                                            <span className="font-mono opacity-80">{p.patientId}</span>
                                                                        </p>
                                                                    </div>
                                                                    {selectedPatientId === p.id && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Current-record vs incoming-file comparison (Import Mode Only,
                                                        issue #158: confirm-you-picked-the-right-patient aid). */}
                                                    {mode === 'import' && selectedPatientId && selectedPatientRecord && activeEntry && (
                                                        <div className="animate-in fade-in slide-in-from-top-2 rounded-md border bg-card p-3 space-y-2">
                                                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Current record vs. this file</p>
                                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                                                                <div className="text-muted-foreground">Patient on file</div>
                                                                <div className="font-medium truncate">
                                                                    {selectedPatientRecord.first_name} {selectedPatientRecord.last_name}
                                                                    <span className="text-muted-foreground ml-1">({formatDate(selectedPatientRecord.dob)})</span>
                                                                </div>
                                                                <div className="text-muted-foreground">Serial (this file)</div>
                                                                <div className={`font-mono flex items-center gap-1 ${serialMatches === false ? 'text-destructive' : serialMatches === true ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                                                                    {serialMatches === true && <Check className="h-3 w-3 shrink-0" />}
                                                                    {serialMatches === false && <X className="h-3 w-3 shrink-0" />}
                                                                    {incomingSerial || 'Unknown'}
                                                                </div>
                                                                <div className="text-muted-foreground">Known device serials</div>
                                                                <div className="font-mono truncate">
                                                                    {currentDevices.length > 0
                                                                        ? currentDevices.map((d: any) => d.serial).join(', ')
                                                                        : <span className="italic text-muted-foreground">None on file</span>}
                                                                </div>
                                                            </div>
                                                            {serialMatches === false && (
                                                                <div className="flex items-start gap-1.5 text-[11px] text-destructive pt-1 border-t">
                                                                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                                                    <span>This file's serial doesn't match any device on file for the selected patient — double-check before confirming.</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Visit Selection (Import Mode Only) */}
                                                    {mode === 'import' && selectedPatientId && (
                                                        <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground uppercase px-1">Assign to Visit</Label>
                                                            <div className="rounded-md border mt-2 overflow-hidden">
                                                                {visits.length > 0 && (
                                                                    <div
                                                                        className={`p-3 border-b cursor-pointer text-sm flex items-center justify-between ${visitMode === 'existing' ? 'bg-muted' : 'hover:bg-muted/50'}`}
                                                                        onClick={() => setVisitMode('existing')}
                                                                    >
                                                                        <span>Existing Visit</span>
                                                                        {visitMode === 'existing' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                                    </div>
                                                                )}
                                                                {visitMode === 'existing' && visits.length > 0 && (
                                                                    <div className="bg-muted max-h-[120px] overflow-y-auto p-1">
                                                                        {visits.map(v => (
                                                                            <div
                                                                                key={v.id}
                                                                                className={`p-2 rounded text-xs cursor-pointer ${selectedVisitId === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                                                                                onClick={() => setSelectedVisitId(v.id)}
                                                                            >
                                                                                <span className="font-semibold">{formatDate(v.interrogation_date)}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <div
                                                                    className={`p-3 cursor-pointer text-sm flex flex-col gap-2 ${visitMode === 'new' ? 'bg-muted' : 'hover:bg-muted/50'}`}
                                                                    onClick={() => setVisitMode('new')}
                                                                >
                                                                    <div className="flex justify-between">
                                                                        <span>Create New Visit</span>
                                                                        {visitMode === 'new' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                                    </div>
                                                                    {visitMode === 'new' && (
                                                                        <Input type="date" className="h-8 bg-background" value={newVisitDate} onChange={e => setNewVisitDate(e.target.value)} />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="new" className="pt-4">
                                                <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-2">
                                                            <Label>First Name *</Label>
                                                            <Input value={newPatient.first_name} onChange={e => setNewPatient({ ...newPatient, first_name: e.target.value })} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Last Name *</Label>
                                                            <Input value={newPatient.last_name} onChange={e => setNewPatient({ ...newPatient, last_name: e.target.value })} />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>DOB *</Label>
                                                        <Input type="date" value={newPatient.dob} onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })} />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>MRN (Optional)</Label>
                                                        <Input value={newPatient.hospitalPatientId} onChange={e => setNewPatient({ ...newPatient, hospitalPatientId: e.target.value })} />
                                                    </div>

                                                    {/* Visit Date - Only for Import Mode */}
                                                    {mode === 'import' && (
                                                        <div className="space-y-2 pt-2 border-t">
                                                            <Label>Visit Date *</Label>
                                                            <Input
                                                                type="date"
                                                                value={newVisitDate}
                                                                onChange={e => setNewVisitDate(e.target.value)}
                                                            />
                                                            <p className="text-[10px] text-muted-foreground">The date this interrogation occurred.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                </div>
                            </ScrollArea>

                            {/* Footer - FIXED at bottom of left pane */}
                            <div className="p-5 border-t bg-background shrink-0 flex flex-col gap-3">
                                <div className="flex gap-3 w-full">
                                    <Button
                                        size="lg"
                                        className="flex-1 font-medium shadow-lg"
                                        onClick={activeTab === 'existing' ? handleConfirm : handleCreate}
                                        disabled={activeTab === 'existing'
                                            ? (!selectedPatientId || (mode === 'import' && visitMode === 'existing' && !selectedVisitId) || (mode === 'import' && checkedCount === 0))
                                            : (!newPatient.last_name || !newPatient.dob || (mode === 'import' && checkedCount === 0))}
                                    >
                                        {mode === 'move' ? 'Move Visit' : (totalCount > 1 ? `Confirm Assignment (${checkedCount} file${checkedCount === 1 ? '' : 's'})` : 'Confirm Assignment')}
                                    </Button>
                                </div>
                                {mode === 'import' && (
                                    <Button variant="ghost" onClick={handleUnmatched} className="w-full text-xs h-8 text-muted-foreground">
                                        {sourceItem?.source === 'pending' ? 'Move to unmatched dir' : 'Skip this file'}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* RIGHT PANE: Preview (Import) or Summary (Move) */}
                        <div className="col-span-8 h-full bg-muted p-6 flex flex-col min-h-0 overflow-hidden">
                            <div className="h-full w-full rounded-xl border bg-background shadow-xl overflow-hidden flex flex-col relative">
                                {mode === 'import' ? (
                                    <>
                                        {/* Import Mode Preview Header */}
                                        <div className="px-4 py-3 border-b bg-muted text-xs font-semibold text-muted-foreground flex justify-between items-center shrink-0">
                                            <span className="truncate">{activeEntry?.file || 'File Preview'}</span>
                                            {totalCount > 1 && (
                                                <span className="text-[10px] font-normal text-muted-foreground shrink-0 ml-2">
                                                    {fileEntries.findIndex(f => f.key === activeEntry?.key) + 1} of {totalCount}
                                                </span>
                                            )}
                                        </div>
                                        {/* Report Viewer for Full Feature Preview */}
                                        <div className="flex-1 overflow-hidden relative">
                                            {activeEntry?.filePath ? (
                                                <ReportViewer
                                                    report={null} // We don't have a report entry yet
                                                    type={getFileType(activeEntry.file)}
                                                    filePath={activeEntry.filePath}
                                                />
                                            ) : (
                                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                                    Preview Unavailable (Missing path)
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <FolderInput className="h-24 w-24 opacity-10 mb-4" />
                                        <h3 className="text-xl font-semibold">Ready to Move</h3>
                                        <p className="max-w-md text-center opacity-70 mt-2">
                                            Select a target patient on the left to move this visit and all its {sourceItem.fileCount} files.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PatientAssignmentModal;

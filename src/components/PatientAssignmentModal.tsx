import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, FileText, AlertCircle, ArrowRight, FolderInput } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReportViewer from './ReportViewer';

interface Patient {
    id: string;
    patientId: string;
    name: string;
    dob: string;
}

interface PatientAssignmentModalProps {
    open: boolean;
    mode: 'import' | 'move';
    sourceItem: any; // FileInfo (import) or VisitInfo (move)
    onResolve: (decision: any) => void;
    onCancel: () => void;
}

const PatientAssignmentModal: React.FC<PatientAssignmentModalProps> = ({ open, mode, sourceItem, onResolve, onCancel }) => {
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

    useEffect(() => {
        if (open && sourceItem) {
            const currentJson = JSON.stringify(sourceItem);
            if (currentJson === prevSourceItemJson) return; // Skip if content hasn't changed
            setPrevSourceItemJson(currentJson);

            // Pre-fill form from preview data
            if (mode === 'import' && sourceItem.previewData) {
                const { patientName, dob, date } = sourceItem.previewData;
                let first = '';
                let last = '';

                if (patientName && patientName !== 'Unknown Unknown') {
                    const parts = patientName.split(' ');
                    if (parts.length > 1) {
                        last = parts.pop() || '';
                        first = parts.join(' ');
                    } else {
                        last = patientName || '';
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
    }, [open, sourceItem, mode, prevSourceItemJson]);

    // Fetch visits when patient selected (Only relevant for Import mode)
    useEffect(() => {
        if (selectedPatientId && mode === 'import') {
            window.electronAPI.getPatientReports(selectedPatientId).then(setVisits);
            setVisitMode('existing');
            setSelectedVisitId(null);
        } else {
            setVisits([]);
        }
    }, [selectedPatientId, mode]);

    const filteredPatients = patients.filter(p =>
        String(p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(p.patientId || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleConfirm = () => {
        if (selectedPatientId) {
            // Validate "Create New Visit" date
            if (mode === 'import' && visitMode === 'new' && !newVisitDate) {
                alert('Please specify a date for the new visit.');
                return;
            }

            if (mode === 'import') {
                onResolve({
                    action: 'assign-patient',
                    patientId: selectedPatientId,
                    visitMode,
                    visitId: visitMode === 'existing' ? selectedVisitId : undefined,
                    visitDate: visitMode === 'new' ? newVisitDate : undefined
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
            alert('Please fill in required patient fields (Last Name, DOB).');
            return;
        }

        if (mode === 'import' && !newVisitDate) {
            alert('Please specify a Visit Date.');
            return;
        }

        onResolve({
            action: 'create-patient',
            patientData: newPatient,
            visitDate: newVisitDate // Used for Import to create visit, for Move it might be unused but passed
        });
    };

    const handleUnmatched = () => {
        onResolve({ action: 'unmatched' });
    };

    const getFileType = (filename: string): 'xml' | 'pdf' | 'text' => {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.xml')) return 'xml';
        if (lower.endsWith('.pdf')) return 'pdf';
        return 'text';
    };

    if (!sourceItem) return null;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
            <DialogContent
                className="max-w-[95vw] w-[1400px] h-[90vh] max-h-[90vh] flex flex-col bg-background/95 backdrop-blur-xl border-primary/20 p-0 overflow-hidden shadow-2xl rounded-xl"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="flex flex-col h-full overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-5 border-b bg-background/50 relative shrink-0">
                        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
                        <DialogTitle className="flex items-center gap-3 text-2xl font-light tracking-tight">
                            <div className={`p-2 rounded-full ring-1 ${mode === 'import' ? 'bg-orange-500/10 ring-orange-500/20' : 'bg-blue-500/10 ring-blue-500/20'}`}>
                                {mode === 'import' ? <AlertCircle className="h-6 w-6 text-orange-500" /> : <FolderInput className="h-6 w-6 text-blue-500" />}
                            </div>
                            <div className="flex flex-col">
                                <span className="flex items-center gap-2">
                                    {mode === 'import' ? 'Manual Sorting Required' : 'Move Visit to Patient'}
                                </span>
                                <span className="text-sm font-normal text-muted-foreground mt-0.5">
                                    {mode === 'import'
                                        ? 'Please identify the patient for this document.'
                                        : 'Select the correct patient to move this visit to.'}
                                </span>
                            </div>
                        </DialogTitle>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0 bg-muted/5 min-h-0">

                        {/* LEFT PANE: Controls (4 columns) */}
                        <div className="col-span-4 border-r bg-background flex flex-col h-full min-h-0 overflow-hidden shadow-xl z-10">
                            <ScrollArea className="flex-1 min-h-0">
                                <div className="p-6 space-y-8">
                                    {/* Info Card */}
                                    <div className="bg-card rounded-xl border p-4 shadow-sm relative overflow-hidden group">
                                        <div className="relative z-10 space-y-4">
                                            {mode === 'import' ? (
                                                <>
                                                    <h3 className="font-semibold text-lg leading-tight break-all">{sourceItem.filename}</h3>
                                                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 bg-muted/30 -mx-4 -mb-4 p-4 border-t">
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Name</span>
                                                            <p className="font-medium truncate">{sourceItem.previewData?.patientName || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Serial</span>
                                                            <p className="font-mono text-xs">{sourceItem.previewData?.serial || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Manufacturer</span>
                                                            <p className="font-medium truncate">{sourceItem.previewData?.manufacturer || 'Unknown'}</p>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Model</span>
                                                            <p className="text-xs truncate">{sourceItem.previewData?.deviceModel || 'Unknown'}</p>
                                                        </div>
                                                        {sourceItem.previewData?.leads && sourceItem.previewData.leads.length > 0 && (
                                                            <div className="col-span-2 border-t pt-2 mt-2">
                                                                <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Leads</span>
                                                                <div className="space-y-1">
                                                                    {sourceItem.previewData.leads.map((l: any, i: number) => (
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
                                                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 bg-muted/30 -mx-4 -mb-4 p-4 border-t">
                                                        <div>
                                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold block mb-1">Date</span>
                                                            <p className="font-medium">{new Date(sourceItem.interrogation_date).toLocaleDateString()}</p>
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
                                            <TabsList className="grid w-full grid-cols-2 h-11 p-1 bg-muted/50">
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
                                                    <div className="border rounded-lg bg-card shadow-inner overflow-hidden flex flex-col h-[280px]">
                                                        <div className="flex-1 overflow-y-auto p-1 space-y-1">
                                                            {filteredPatients.map(p => (
                                                                <div
                                                                    key={p.id}
                                                                    onClick={() => setSelectedPatientId(p.id)}
                                                                    className={`flex items-center justify-between p-3 rounded-md cursor-pointer transition-all border ${selectedPatientId === p.id
                                                                        ? 'bg-primary/10 border-primary/30 shadow-sm'
                                                                        : 'hover:bg-muted/50 border-transparent'
                                                                        }`}
                                                                >
                                                                    <div className="min-w-0 pr-2">
                                                                        <p className={`font-medium text-sm truncate ${selectedPatientId === p.id ? 'text-primary' : ''}`}>{p.name}</p>
                                                                        <p className="text-xs opacity-70 truncate flex items-center gap-1.5 mt-0.5">
                                                                            <span>{p.dob}</span>
                                                                            <span className="font-mono opacity-80">{p.patientId}</span>
                                                                        </p>
                                                                    </div>
                                                                    {selectedPatientId === p.id && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Visit Selection (Import Mode Only) */}
                                                    {mode === 'import' && selectedPatientId && (
                                                        <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground uppercase px-1">Assign to Visit</Label>
                                                            <div className="rounded-md border mt-2 overflow-hidden">
                                                                {visits.length > 0 && (
                                                                    <div
                                                                        className={`p-3 border-b cursor-pointer text-sm flex items-center justify-between ${visitMode === 'existing' ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                                                                        onClick={() => setVisitMode('existing')}
                                                                    >
                                                                        <span>Existing Visit</span>
                                                                        {visitMode === 'existing' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                                    </div>
                                                                )}
                                                                {visitMode === 'existing' && visits.length > 0 && (
                                                                    <div className="bg-muted/10 max-h-[120px] overflow-y-auto p-1">
                                                                        {visits.map(v => (
                                                                            <div
                                                                                key={v.id}
                                                                                className={`p-2 rounded text-xs cursor-pointer ${selectedVisitId === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                                                                                onClick={() => setSelectedVisitId(v.id)}
                                                                            >
                                                                                <span className="font-semibold">{v.interrogation_date}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <div
                                                                    className={`p-3 cursor-pointer text-sm flex flex-col gap-2 ${visitMode === 'new' ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
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
                                        disabled={activeTab === 'existing' ? !selectedPatientId : (!newPatient.last_name || !newPatient.dob)}
                                    >
                                        {mode === 'move' ? 'Move Visit' : 'Confirm Assignment'}
                                    </Button>
                                </div>
                                {mode === 'import' && (
                                    <Button variant="ghost" onClick={handleUnmatched} className="w-full text-xs h-8 text-muted-foreground">
                                        Skip this file
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* RIGHT PANE: Preview (Import) or Summary (Move) */}
                        <div className="col-span-8 h-full bg-muted/10 p-6 flex flex-col min-h-0 overflow-hidden">
                            <div className="h-full w-full rounded-xl border bg-background shadow-xl overflow-hidden flex flex-col relative">
                                {mode === 'import' ? (
                                    <>
                                        {/* Import Mode Preview Header */}
                                        <div className="px-4 py-3 border-b bg-muted/30 text-xs font-semibold text-muted-foreground flex justify-between items-center shrink-0">
                                            <span>File Preview</span>
                                        </div>
                                        {/* Report Viewer for Full Feature Preview */}
                                        <div className="flex-1 overflow-hidden relative">
                                            {sourceItem.tempPath ? (
                                                <ReportViewer
                                                    report={null} // We don't have a report entry yet
                                                    type={getFileType(sourceItem.filename)}
                                                    filePath={sourceItem.tempPath}
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

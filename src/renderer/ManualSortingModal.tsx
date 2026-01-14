import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, FileText, AlertCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Patient {
    id: string;
    patientId: string;
    name: string;
    dob: string;
}

interface ManualSortingModalProps {
    open: boolean;
    fileInfo: any;
    onResolve: (decision: any) => void;
}

import PdfViewer from './PdfViewer';

const ManualSortingModal: React.FC<ManualSortingModalProps> = ({ open, fileInfo, onResolve }) => {
    const [activeTab, setActiveTab] = useState('existing');
    const [searchTerm, setSearchTerm] = useState('');
    const [patients, setPatients] = useState<Patient[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

    const [visits, setVisits] = useState<any[]>([]);
    const [visitMode, setVisitMode] = useState<'existing' | 'new'>('existing');
    const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
    const [newVisitDate, setNewVisitDate] = useState('');
    const [textContent, setTextContent] = useState<string | null>(null);

    // New Patient Form
    const [newPatient, setNewPatient] = useState({
        first_name: '',
        last_name: '',
        dob: '',
        hospitalPatientId: ''
    });

    useEffect(() => {
        if (open && fileInfo) {
            setTextContent(null);

            // Check for XML/Text files
            const ext = fileInfo.filename?.toLowerCase().split('.').pop();
            if (['xml', 'log', 'txt'].includes(ext) && fileInfo.tempPath) {
                window.electronAPI.readFileText(fileInfo.tempPath)
                    .then(setTextContent)
                    .catch(e => console.error('Failed to read file text', e));
            }

            // Load patients for search
            window.electronAPI.getPatientDirectories().then((data: any[]) => {
                setPatients(data);
            });

            // Pre-fill form if data is available
            if (fileInfo?.previewData) {
                const { patientName, dob, date } = fileInfo.previewData;
                if (patientName) {
                    const parts = patientName.split(' ');
                    if (parts.length > 1) {
                        setNewPatient(prev => ({ ...prev, last_name: parts.pop(), first_name: parts.join(' ') }));
                    } else {
                        setNewPatient(prev => ({ ...prev, last_name: patientName }));
                    }
                }
                if (dob) {
                    setNewPatient(prev => ({ ...prev, dob: dob }));
                }
                if (date) {
                    const parsedDate = date.split('T')[0];
                    setNewVisitDate(parsedDate);
                }
            }
        }
    }, [open, fileInfo]);

    // Fetch visits when patient selected
    useEffect(() => {
        if (selectedPatientId) {
            window.electronAPI.getPatientReports(selectedPatientId).then(setVisits);
            // Default to 'new' if provided date doesn't match? Or just default to new if we have a date from file
            // Actually, default to 'existing' if there are visits, but maybe 'new' if we have a specific date from file?
            // Let's default to 'existing' but let user choose.
            setVisitMode('existing');
            setSelectedVisitId(null);
        } else {
            setVisits([]);
        }
    }, [selectedPatientId]);

    const filteredPatients = patients.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleAssign = () => {
        if (selectedPatientId) {
            onResolve({
                action: 'assign-patient',
                patientId: selectedPatientId,
                visitMode,
                visitId: visitMode === 'existing' ? selectedVisitId : undefined,
                visitDate: visitMode === 'new' ? newVisitDate : undefined
            });
        }
    };

    const handleCreate = () => {
        if (!newPatient.last_name || !newPatient.dob) {
            alert('Please fill in required patient fields (Last Name, DOB).');
            return;
        }
        if (!newVisitDate) {
            alert('Please specify a Visit Date.');
            return;
        }

        onResolve({
            action: 'create-patient',
            patientData: newPatient,
            visitDate: newVisitDate
        });
    };

    const handleUnmatched = () => {
        onResolve({ action: 'unmatched' });
    };

    if (!fileInfo) return null;

    const isPdf = fileInfo.filename?.toLowerCase().endsWith('.pdf');

    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col bg-background/95 backdrop-blur-xl border-primary/20 p-0 overflow-hidden shadow-2xl rounded-xl">
                <div className="flex flex-col h-full">
                    {/* Header with modern gradient border bottom */}
                    <div className="px-6 py-5 border-b bg-background/50 relative shrink-0">
                        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
                        <DialogTitle className="flex items-center gap-3 text-2xl font-light tracking-tight">
                            <div className="bg-orange-500/10 p-2 rounded-full ring-1 ring-orange-500/20">
                                <AlertCircle className="h-6 w-6 text-orange-500" />
                            </div>
                            <div className="flex flex-col">
                                <span className="flex items-center gap-2">
                                    Manual Sorting Required
                                    <Badge variant="outline" className="text-[10px] font-mono opacity-50 ml-2">v2.1</Badge>
                                </span>
                                <span className="text-sm font-normal text-muted-foreground mt-0.5">
                                    Please identify the patient for this document to complete the import.
                                </span>
                            </div>
                        </DialogTitle>
                    </div>

                    {/* Main Content - 2 Pane Layout */}
                    <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0 bg-muted/5">

                        {/* LEFT PANE: Controls (4 columns) - Increased visual separation */}
                        <div className="col-span-4 border-r bg-background flex flex-col h-full overflow-hidden shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] z-10">
                            <ScrollArea className="flex-1">
                                <div className="p-6 space-y-8">
                                    {/* File Metadata Card - Sleek Design */}
                                    <div className="bg-card rounded-xl border p-4 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <FileText className="w-24 h-24 -mr-8 -mt-8 rotate-12" />
                                        </div>

                                        <div className="relative z-10 space-y-4">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className="font-semibold text-lg leading-tight break-all pr-4">{fileInfo.filename}</h3>
                                                    <Badge variant="secondary" className="mt-2">
                                                        {isPdf ? 'PDF Document' : 'Log / Text File'}
                                                    </Badge>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 text-sm pt-2 bg-muted/30 -mx-4 -mb-4 p-4 border-t">
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Extracted Name</span>
                                                    <p className="font-medium truncate">{fileInfo.previewData?.patientName || 'Unknown'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Serial Number</span>
                                                    <p className="font-mono text-xs bg-background/50 py-0.5 px-1.5 rounded inline-block border">
                                                        {fileInfo.previewData?.serial || 'Unknown'}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Extracted DOB</span>
                                                    <p className="font-medium">{fileInfo.previewData?.dob || 'Unknown'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Date</span>
                                                    <p className="font-medium">{fileInfo.previewData?.date ? fileInfo.previewData.date.split('T')[0] : 'Unknown'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Area */}
                                    <div className="space-y-4">
                                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                            <TabsList className="grid w-full grid-cols-2 h-11 p-1 bg-muted/50">
                                                <TabsTrigger value="existing" className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-sm">Match Existing</TabsTrigger>
                                                <TabsTrigger value="new" className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all text-sm">Create New</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="existing" className="space-y-4 pt-4 animate-in slide-in-from-left-2 duration-300">
                                                <div className="space-y-3">
                                                    <div className="relative">
                                                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input
                                                            placeholder="Search by name or ID..."
                                                            className="pl-9 bg-muted/20 border-border/60 focus-visible:bg-background h-10 transition-colors"
                                                            value={searchTerm}
                                                            onChange={e => setSearchTerm(e.target.value)}
                                                        />
                                                    </div>

                                                    {/* Patient List - Visually Distinct */}
                                                    <div className="border rounded-lg bg-card shadow-inner overflow-hidden flex flex-col h-[280px]">
                                                        <div className="p-2 border-b bg-muted/10 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                                            Select Patient
                                                        </div>
                                                        <div className="flex-1 overflow-y-auto p-1 space-y-1">
                                                            {filteredPatients.length === 0 ? (
                                                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3 opacity-60">
                                                                    <UserPlus className="h-10 w-10 stroke-1" />
                                                                    <p className="text-sm">No patients found</p>
                                                                </div>
                                                            ) : (
                                                                filteredPatients.map(p => (
                                                                    <div
                                                                        key={p.id}
                                                                        onClick={() => setSelectedPatientId(p.id)}
                                                                        className={`flex items-center justify-between p-3 rounded-md cursor-pointer transition-all border ${selectedPatientId === p.id
                                                                                ? 'bg-primary/10 border-primary/30 shadow-sm relative z-10'
                                                                                : 'hover:bg-muted/50 border-transparent text-muted-foreground hover:text-foreground'
                                                                            }`}
                                                                    >
                                                                        <div className="min-w-0 pr-2">
                                                                            <p className={`font-medium text-sm truncate ${selectedPatientId === p.id ? 'text-primary' : ''}`}>{p.name}</p>
                                                                            <p className="text-xs opacity-70 truncate flex items-center gap-1.5 mt-0.5">
                                                                                <span>{p.dob}</span>
                                                                                <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                                                                                <span className="font-mono opacity-80">{p.patientId}</span>
                                                                            </p>
                                                                        </div>
                                                                        {selectedPatientId === p.id && (
                                                                            <div className="h-2.5 w-2.5 rounded-full bg-primary shadow-sm ring-2 ring-primary/20 shrink-0" />
                                                                        )}
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Visit Selection - Conditional */}
                                                    {selectedPatientId && (
                                                        <div className="animate-in fade-in slide-in-from-top-2 pt-2">
                                                            <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Assign to Visit</Label>

                                                                {visits.length > 0 && (
                                                                    <div
                                                                        className={`p-3 rounded-md border cursor-pointer text-sm flex items-center justify-between transition-all ${visitMode === 'existing' ? 'bg-background border-primary shadow-sm' : 'bg-transparent border-transparent hover:bg-background/50 hover:border-border/50'}`}
                                                                        onClick={() => setVisitMode('existing')}
                                                                    >
                                                                        <span className="font-medium">Existing Visit</span>
                                                                        <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${visitMode === 'existing' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                                            {visitMode === 'existing' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {visitMode === 'existing' && visits.length > 0 && (
                                                                    <div className="ml-1 pl-3 border-l-2 border-primary/20 space-y-1 mb-2">
                                                                        {visits.map(v => (
                                                                            <div
                                                                                key={v.id}
                                                                                className={`p-2 rounded text-xs border cursor-pointer transition-colors ${selectedVisitId === v.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border/50 hover:border-primary/30'}`}
                                                                                onClick={() => setSelectedVisitId(v.id)}
                                                                            >
                                                                                <div className="flex justify-between items-center mb-0.5">
                                                                                    <span className="font-semibold">{v.interrogation_date}</span>
                                                                                </div>
                                                                                <div className="opacity-80 text-[10px] truncate">{v.manufacturer} {v.device?.type}</div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                                <div
                                                                    className={`p-3 rounded-md border cursor-pointer text-sm flex flex-col gap-3 transition-all ${visitMode === 'new' ? 'bg-background border-primary shadow-sm' : 'bg-transparent border-transparent hover:bg-background/50 hover:border-border/50'}`}
                                                                    onClick={() => setVisitMode('new')}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="font-medium">Create New Visit</span>
                                                                        <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${visitMode === 'new' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                                            {visitMode === 'new' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                                        </div>
                                                                    </div>
                                                                    {visitMode === 'new' && (
                                                                        <div className="animate-in slide-in-from-top-1">
                                                                            <Label className="text-[10px] text-muted-foreground mb-1.5 block">Visit Date</Label>
                                                                            <Input
                                                                                type="date"
                                                                                className="h-9 bg-background focus-visible:ring-1"
                                                                                value={newVisitDate}
                                                                                onChange={e => setNewVisitDate(e.target.value)}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="new" className="pt-4 animate-in slide-in-from-right-2 duration-300">
                                                <div className="bg-card border rounded-xl p-5 shadow-sm space-y-5">
                                                    <div className="flex items-center gap-3 pb-2 border-b">
                                                        <div className="bg-primary/10 p-2 rounded-lg">
                                                            <UserPlus className="h-5 w-5 text-primary" />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-medium text-sm">New Patient Profile</h4>
                                                            <p className="text-xs text-muted-foreground">Enter details to create a new record</p>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-2">
                                                            <Label>First Name <span className="text-destructive">*</span></Label>
                                                            <Input
                                                                value={newPatient.first_name}
                                                                onChange={e => setNewPatient({ ...newPatient, first_name: e.target.value })}
                                                                className="bg-background"
                                                                placeholder="e.g. John"
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Last Name <span className="text-destructive">*</span></Label>
                                                            <Input
                                                                value={newPatient.last_name}
                                                                onChange={e => setNewPatient({ ...newPatient, last_name: e.target.value })}
                                                                className="bg-background"
                                                                placeholder="e.g. Doe"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Date of Birth <span className="text-destructive">*</span></Label>
                                                        <Input
                                                            type="date"
                                                            value={newPatient.dob}
                                                            onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })}
                                                            className="bg-background"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Hospital MRN <span className="text-muted-foreground font-normal ml-1">(Optional)</span></Label>
                                                        <Input
                                                            value={newPatient.hospitalPatientId}
                                                            onChange={e => setNewPatient({ ...newPatient, hospitalPatientId: e.target.value })}
                                                            className="bg-background"
                                                            placeholder="Patient ID Number"
                                                        />
                                                    </div>

                                                    <div className="pt-4 mt-2 border-t space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <Label>Visit Date <span className="text-destructive">*</span></Label>
                                                            <Badge variant="outline" className="font-normal text-[10px]">Required for Report</Badge>
                                                        </div>
                                                        <Input
                                                            type="date"
                                                            value={newVisitDate}
                                                            onChange={e => setNewVisitDate(e.target.value)}
                                                            className="bg-background"
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                </div>
                            </ScrollArea>

                            {/* Actions Footer - Fixed at bottom of Left Pane */}
                            <div className="p-5 border-t bg-background shrink-0 flex flex-col gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] z-20">
                                <div className="flex gap-3 w-full">
                                    {activeTab === 'existing' ? (
                                        <Button
                                            size="lg"
                                            className="flex-1 font-medium shadow-lg hover:shadow-xl transition-all"
                                            onClick={handleAssign}
                                            disabled={!selectedPatientId || (visitMode === 'existing' && !selectedVisitId) || (visitMode === 'new' && !newVisitDate)}
                                        >
                                            Confirm Assignment
                                        </Button>
                                    ) : (
                                        <Button
                                            size="lg"
                                            className="flex-1 font-medium shadow-lg hover:shadow-xl transition-all"
                                            onClick={handleCreate}
                                            disabled={!newPatient.last_name || !newPatient.dob || !newVisitDate}
                                        >
                                            <UserPlus className="mr-2 h-5 w-5" /> Create & Assign
                                        </Button>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    onClick={handleUnmatched}
                                    className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/5 text-xs h-8"
                                >
                                    Skip this file (Move to Unmatched)
                                </Button>
                            </div>
                        </div>

                        {/* RIGHT PANE: Preview (8 columns) - Modern Frame */}
                        <div className="col-span-8 h-full bg-muted/10 flex flex-col relative overflow-hidden p-6">
                            <div className="h-full w-full rounded-xl border bg-background shadow-xl overflow-hidden flex flex-col ring-1 ring-border/50">
                                {/* Preview Header */}
                                <div className="px-4 py-3 border-b bg-muted/30 text-xs font-semibold text-muted-foreground flex justify-between items-center shrink-0 backdrop-blur-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                        <span>File Preview</span>
                                    </div>
                                    {isPdf && <span className="bg-blue-500/10 text-blue-600 border border-blue-200/50 px-2 py-0.5 rounded text-[10px] font-medium">PDF Viewer Active</span>}
                                    {['xml', 'log', 'txt'].includes(fileInfo.filename?.toLowerCase().split('.').pop() || '') && <span className="bg-orange-500/10 text-orange-600 border border-orange-200/50 px-2 py-0.5 rounded text-[10px] font-medium">Text Viewer Active</span>}
                                </div>

                                {/* Preview Content Area */}
                                <div className="flex-1 bg-gray-50/50 overflow-auto relative flex items-center justify-center p-1">
                                    {isPdf && fileInfo.tempPath ? (
                                        <div className="min-h-full w-full flex justify-center p-4">
                                            <PdfViewer pdfPath={fileInfo.tempPath} />
                                        </div>
                                    ) : (fileInfo.filename?.toLowerCase().endsWith('.xml') || fileInfo.filename?.toLowerCase().endsWith('.log') || fileInfo.filename?.toLowerCase().endsWith('.txt')) ? (
                                        <div className="w-full h-full p-6 overflow-auto bg-white shadow-sm border rounded m-4 font-mono text-xs whitespace-pre-wrap text-slate-700 leading-relaxed selection:bg-yellow-200 selection:text-black">
                                            {textContent || <div className="flex flex-col items-center justify-center h-full opacity-50"><div className="animate-spin h-6 w-6 border-2 border-primary rounded-full border-t-transparent mb-2"></div>Loading content...</div>}
                                        </div>
                                    ) : (
                                        <div className="text-center p-12 text-muted-foreground">
                                            <div className="bg-muted/30 p-6 rounded-full inline-block mb-6">
                                                <FileText className="h-16 w-16 opacity-20" />
                                            </div>
                                            <h3 className="text-lg font-medium mb-1">Preview Unavailable</h3>
                                            <p className="max-w-xs mx-auto opacity-70">This file type cannot be previewed directly. Please rely on the extracted metadata.</p>
                                            <p className="text-xs mt-4 px-3 py-1 bg-muted rounded-full inline-block font-mono opacity-60">{fileInfo.filename}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </DialogContent>
        </Dialog >
    );
};

export default ManualSortingModal;

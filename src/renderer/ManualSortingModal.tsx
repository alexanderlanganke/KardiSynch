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

    // New Patient Form
    const [newPatient, setNewPatient] = useState({
        first_name: '',
        last_name: '',
        dob: '',
        hospitalPatientId: ''
    });

    useEffect(() => {
        if (open) {
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
            <DialogContent className="max-w-[90vw] w-[1200px] h-[85vh] flex flex-col bg-background/95 backdrop-blur-xl border-primary/20 p-0 overflow-hidden">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="px-6 py-4 border-b shrink-0">
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <AlertCircle className="h-6 w-6 text-yellow-500" />
                            <span className="bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent">
                                Ambiguous File Detected <span className="text-xs opacity-50 ml-2">(v2)</span>
                            </span>
                        </DialogTitle>
                        <DialogDescription className="mt-1">
                            Please verify the document content and match it to a patient.
                        </DialogDescription>
                    </div>

                    {/* Main Content - 2 Pane Layout */}
                    <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0">

                        {/* LEFT PANE: Metadata & Actions (4 columns) */}
                        <div className="col-span-4 border-r flex flex-col bg-muted/10 h-full overflow-hidden">
                            <ScrollArea className="flex-1">
                                <div className="p-6 space-y-6">
                                    {/* File Metadata Card */}
                                    <Card className="bg-background/50 border-dashed">
                                        <CardContent className="p-4 space-y-4">
                                            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                                                <FileText className="h-8 w-8 text-primary/70" />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate" title={fileInfo.filename}>{fileInfo.filename}</p>
                                                    <Badge variant="outline" className="text-[10px] h-5 px-1 mt-1">
                                                        {isPdf ? 'PDF Document' : 'Unknown Type'}
                                                    </Badge>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 text-sm">
                                                <div>
                                                    <span className="text-muted-foreground text-xs block mb-1">Extracted Name</span>
                                                    <p className="font-medium truncate" title={fileInfo.previewData?.patientName}>{fileInfo.previewData?.patientName || 'Unknown'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground text-xs block mb-1">Extracted DOB</span>
                                                    <p className="font-medium">{fileInfo.previewData?.dob || 'Unknown'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground text-xs block mb-1">Serial Number</span>
                                                    <p className="font-medium font-mono">{fileInfo.previewData?.serial || 'Unknown'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground text-xs block mb-1">Date</span>
                                                    <p className="font-medium">{fileInfo.previewData?.date ? fileInfo.previewData.date.split('T')[0] : 'Unknown'}</p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Action Tabs */}
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Action Required</h3>
                                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                            <TabsList className="grid w-full grid-cols-2">
                                                <TabsTrigger value="existing">Match Existing</TabsTrigger>
                                                <TabsTrigger value="new">Create New</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="existing" className="space-y-4 pt-4">
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                    <Input
                                                        placeholder="Search patients..."
                                                        className="pl-8"
                                                        value={searchTerm}
                                                        onChange={e => setSearchTerm(e.target.value)}
                                                    />
                                                </div>

                                                <div className="max-h-[200px] overflow-y-auto rounded-md border bg-background p-2">
                                                    {filteredPatients.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground space-y-2">
                                                            <UserPlus className="h-8 w-8 opacity-20" />
                                                            <p className="text-sm">No patients found</p>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            {filteredPatients.map(p => (
                                                                <div
                                                                    key={p.id}
                                                                    onClick={() => setSelectedPatientId(p.id)}
                                                                    className={`flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-all ${selectedPatientId === p.id ? 'bg-primary/10 border-primary/40 shadow-sm' : 'hover:bg-muted/50 border border-transparent'}`}
                                                                >
                                                                    <div className="min-w-0 pr-2">
                                                                        <p className="font-medium text-sm truncate">{p.name}</p>
                                                                        <p className="text-xs text-muted-foreground truncate">{p.dob} • <span className="font-mono">{p.patientId}</span></p>
                                                                    </div>
                                                                    {selectedPatientId === p.id && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {selectedPatientId && (
                                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-1 pt-2 border-t">
                                                        <Label className="text-xs font-semibold text-muted-foreground">Select Visit</Label>

                                                        <div className="space-y-2">
                                                            {visits.length > 0 && (
                                                                <div
                                                                    className={`p-2 rounded border cursor-pointer text-sm flex items-center gap-2 ${visitMode === 'existing' ? 'bg-primary/5 border-primary/50' : 'hover:bg-muted'}`}
                                                                    onClick={() => setVisitMode('existing')}
                                                                >
                                                                    <div className={`h-3 w-3 rounded-full border flex items-center justify-center ${visitMode === 'existing' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                                        {visitMode === 'existing' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                                                    </div>
                                                                    <span>Existing Visit</span>
                                                                </div>
                                                            )}

                                                            {visitMode === 'existing' && visits.length > 0 && (
                                                                <div className="ml-5 max-h-[120px] overflow-y-auto space-y-1 border-l-2 pl-2 border-muted">
                                                                    {visits.map(v => (
                                                                        <div
                                                                            key={v.id}
                                                                            className={`p-2 rounded text-xs border cursor-pointer ${selectedVisitId === v.id ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted'}`}
                                                                            onClick={() => setSelectedVisitId(v.id)}
                                                                        >
                                                                            <div className="font-medium">{v.interrogation_date}</div>
                                                                            <div className="opacity-80 scale-90 origin-left">{v.manufacturer} {v.device?.type || 'Device'}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            <div
                                                                className={`p-2 rounded border cursor-pointer text-sm flex flex-col gap-2 ${visitMode === 'new' ? 'bg-primary/5 border-primary/50' : 'hover:bg-muted'}`}
                                                                onClick={() => setVisitMode('new')}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`h-3 w-3 rounded-full border flex items-center justify-center ${visitMode === 'new' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                                        {visitMode === 'new' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                                                    </div>
                                                                    <span>Create New Visit</span>
                                                                </div>
                                                                {visitMode === 'new' && (
                                                                    <Input
                                                                        type="date"
                                                                        className="h-8 text-xs ml-5 w-[calc(100%-1.25rem)]"
                                                                        value={newVisitDate}
                                                                        onChange={e => setNewVisitDate(e.target.value)}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </TabsContent>

                                            <TabsContent value="new" className="space-y-4 pt-4">
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">First Name</Label>
                                                            <Input
                                                                value={newPatient.first_name}
                                                                onChange={e => setNewPatient({ ...newPatient, first_name: e.target.value })}
                                                                className="h-8"
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Last Name</Label>
                                                            <Input
                                                                value={newPatient.last_name}
                                                                onChange={e => setNewPatient({ ...newPatient, last_name: e.target.value })}
                                                                className="h-8"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Date of Birth</Label>
                                                        <Input
                                                            type="date"
                                                            value={newPatient.dob}
                                                            onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Hospital MRN</Label>
                                                        <Input
                                                            value={newPatient.hospitalPatientId}
                                                            onChange={e => setNewPatient({ ...newPatient, hospitalPatientId: e.target.value })}
                                                            className="h-8"
                                                            placeholder="Optional"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 pt-2 border-t">
                                                        <Label className="text-xs font-semibold">Visit Date</Label>
                                                        <Input
                                                            type="date"
                                                            value={newVisitDate}
                                                            onChange={e => setNewVisitDate(e.target.value)}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                </div>
                            </ScrollArea>

                            {/* Actions Footer (Inside Left Pane) */}
                            <div className="p-4 border-t bg-background shrink-0 flex flex-col gap-3">
                                <div className="flex gap-2 w-full">
                                    {activeTab === 'existing' ? (
                                        <Button className="flex-1" onClick={handleAssign} disabled={!selectedPatientId || (visitMode === 'existing' && !selectedVisitId) || (visitMode === 'new' && !newVisitDate)}>
                                            Assign to Selected
                                        </Button>
                                    ) : (
                                        <Button className="flex-1" onClick={handleCreate} disabled={!newPatient.last_name || !newPatient.dob || !newVisitDate}>
                                            <UserPlus className="mr-2 h-4 w-4" /> Create & Assign
                                        </Button>
                                    )}
                                </div>
                                <Button variant="ghost" onClick={handleUnmatched} className="w-full text-muted-foreground hover:text-destructive text-xs">
                                    Skip (I don't know)
                                </Button>
                            </div>
                        </div>

                        {/* RIGHT PANE: Preview (8 columns) */}
                        <div className="col-span-8 h-full bg-muted/20 flex flex-col relative overflow-hidden">
                            <div className="absolute inset-0 p-4">
                                <div className="h-full w-full rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col">
                                    <div className="px-4 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground flex justify-between items-center">
                                        <span>Document Preview</span>
                                        {isPdf && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px]">PDF Viewer</span>}
                                    </div>
                                    <div className="flex-1 bg-gray-50 overflow-auto relative flex items-center justify-center">
                                        {isPdf && fileInfo.tempPath ? (
                                            <div className="min-h-full w-full flex justify-center p-4">
                                                <PdfViewer pdfPath={fileInfo.tempPath} />
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 text-muted-foreground">
                                                <FileText className="h-16 w-16 mx-auto mb-4 opacity-20" />
                                                <p>Preview not available for this file type</p>
                                                <p className="text-xs mt-2 opacity-60">({fileInfo.filename})</p>
                                            </div>
                                        )}
                                    </div>
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

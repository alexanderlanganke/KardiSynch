import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { History, FileText, AlertTriangle, CheckCircle, HelpCircle, ArrowRight, UserPlus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

const ImportHistory: React.FC = () => {
    const [sessions, setSessions] = useState<any[]>([]);
    const [selectedSession, setSelectedSession] = useState<any | null>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Move File State
    const [moveFileModalOpen, setMoveFileModalOpen] = useState(false);
    const [fileToMove, setFileToMove] = useState<any | null>(null);
    const [patients, setPatients] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTargetPatient, setSelectedTargetPatient] = useState<string | null>(null);

    // New Patient Creation State
    const [activeMoveTab, setActiveMoveTab] = useState('existing');
    const [newPatient, setNewPatient] = useState({
        first_name: '',
        last_name: '',
        dob: '',
        hospitalPatientId: ''
    });

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            const history = await window.electronAPI.getImportHistory();
            setSessions(history);
        } catch (e) {
            console.error(e);
        }
    };

    const handleSessionClick = async (session: any) => {
        setSelectedSession(session);
        setLoading(true);
        try {
            const sessionEvents = await window.electronAPI.getImportSessionEvents(session.id);
            setEvents(sessionEvents);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const parseSummary = (json: string) => {
        try {
            return JSON.parse(json);
        } catch {
            return {};
        }
    };

    const handleMoveClick = (event: any) => {
        setFileToMove(event);
        setMoveFileModalOpen(true);
        // Load patients if not already loaded
        if (patients.length === 0) {
            window.electronAPI.getPatientDirectories().then(setPatients);
        }
    };

    const [visits, setVisits] = useState<any[]>([]);
    const [visitMode, setVisitMode] = useState<'existing' | 'new'>('existing');
    const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
    const [newVisitDate, setNewVisitDate] = useState('');

    useEffect(() => {
        if (selectedTargetPatient && activeMoveTab === 'existing') {
            // Fetch visits for the selected patient
            window.electronAPI.getPatientReports(selectedTargetPatient).then(setVisits);
            setSelectedVisitId(null);
            setVisitMode('existing');
            setNewVisitDate('');
        } else {
            setVisits([]);
        }
    }, [selectedTargetPatient, activeMoveTab]);

    const confirmMove = async () => {
        if (!fileToMove) return;

        let finalPatientId = selectedTargetPatient;

        if (activeMoveTab === 'new') {
            // Create Patient First
            if (!newPatient.last_name || !newPatient.dob) {
                alert('Please fill in required patient fields.');
                return;
            }
            try {
                const res = await window.electronAPI.createPatient(newPatient);
                if (res && res.id) {
                    finalPatientId = res.id;
                } else {
                    alert('Failed to create patient: No ID returned.');
                    return;
                }
            } catch (e: any) {
                console.error('Failed to create patient', e);
                alert(`Failed to create patient: ${e.message || e}`);
                return;
            }
        }

        if (!finalPatientId) {
            alert('No target patient selected or created.');
            return;
        }

        // Validation
        if (activeMoveTab === 'existing') {
            if (visitMode === 'existing' && !selectedVisitId && visits.length > 0) return;
            if (visitMode === 'new' && !newVisitDate) return;
        } else {
            // For new patient, we MUST have a visit date (to create the report)
            // We reuse newVisitDate state for this
            if (!newVisitDate) {
                alert('Visit Date is required when creating a new patient.');
                return;
            }
        }

        try {
            await window.electronAPI.moveImportedFile(
                fileToMove.id,
                finalPatientId,
                activeMoveTab === 'existing' && visitMode === 'existing' ? selectedVisitId || undefined : undefined,
                (activeMoveTab === 'new' || visitMode === 'new') ? newVisitDate : undefined
            );
            setMoveFileModalOpen(false);
            setFileToMove(null);
            setSelectedTargetPatient(null);
            setSelectedVisitId(null);
            setNewVisitDate('');
            setVisits([]);
            setNewPatient({ first_name: '', last_name: '', dob: '', hospitalPatientId: '' });
            setActiveMoveTab('existing');
            // Refresh events
            handleSessionClick(selectedSession);
            // alert('File moved successfully.'); // Optional
        } catch (e: any) {
            console.error('Failed to move file', e);
            alert(`Failed to move file: ${e.message || e}`);
        }
    };

    const filteredPatients = patients.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="container mx-auto p-6 max-w-7xl h-full flex flex-col gap-6">
            <div className="flex items-center gap-4">
                <History className="h-8 w-8 text-primary" />
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Import History</h1>
                    <p className="text-muted-foreground">View past import sessions and correct errors.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Session List */}
                <Card className="lg:col-span-1 flex flex-col min-h-0 bg-background/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle>Sessions</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0 p-0">
                        <ScrollArea className="h-[600px] px-6 pb-6">
                            <div className="space-y-3">
                                {sessions.map(session => {
                                    const summary = parseSummary(session.summary);
                                    return (
                                        <div
                                            key={session.id}
                                            onClick={() => handleSessionClick(session)}
                                            className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${selectedSession?.id === session.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/50 hover:bg-muted/50'}`}
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <Badge variant={session.status === 'completed' ? 'outline' : 'secondary'}>
                                                    {session.status}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(session.timestamp).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex gap-4 text-sm text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <CheckCircle className="h-3 w-3 text-green-500" /> {summary.imported || 0}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <HelpCircle className="h-3 w-3 text-yellow-500" /> {summary.unmatched || 0}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-red-500" /> {summary.errors || 0}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                {/* Session Details */}
                <Card className="lg:col-span-2 flex flex-col min-h-0 bg-background/50 backdrop-blur-sm">
                    <CardHeader className="border-b">
                        <CardTitle>{selectedSession ? 'Session Details' : 'Select a Session'}</CardTitle>
                        {selectedSession && <CardDescription>ID: {selectedSession.id}</CardDescription>}
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0 p-0">
                        {!selectedSession ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Select a session request to view details
                            </div>
                        ) : loading ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
                        ) : (
                            <ScrollArea className="h-[600px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Time</TableHead>
                                            <TableHead>File</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Outcome</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {events.map(event => (
                                            <TableRow key={event.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">
                                                    {new Date(event.timestamp).toLocaleTimeString()}
                                                </TableCell>
                                                <TableCell className="max-w-[200px] truncate" title={event.file_path}>
                                                    <div className="flex items-center gap-2">
                                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                                        <span className="truncate">
                                                            {event.file_path ? event.file_path.split(/[\\/]/).pop() : 'Unknown'}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={`
                                                        ${event.status === 'imported' ? 'text-green-600 border-green-200 bg-green-50' : ''}
                                                        ${event.status === 'manually_sorted' ? 'text-blue-600 border-blue-200 bg-blue-50' : ''}
                                                        ${event.status === 'unmatched' ? 'text-yellow-600 border-yellow-200 bg-yellow-50' : ''}
                                                        ${event.status === 'error' ? 'text-red-600 border-red-200 bg-red-50' : ''}
                                                    `}>
                                                        {event.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {event.patient_id ? (
                                                        <span className="font-medium">
                                                            {event.first_name} {event.last_name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground italic">{event.message}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {(event.status === 'imported' || event.status === 'manually_sorted' || event.status === 'unmatched') && (
                                                        <Button variant="ghost" size="sm" onClick={() => handleMoveClick(event)}>
                                                            Move
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Move File Modal */}
            <Dialog open={moveFileModalOpen} onOpenChange={setMoveFileModalOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Move File to Another Patient</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6">
                        <p className="text-sm text-muted-foreground">
                            Assignment for <strong>{fileToMove?.file_path?.split(/[\\/]/).pop()}</strong>.
                        </p>

                        <Tabs value={activeMoveTab} onValueChange={setActiveMoveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="existing">Match Existing</TabsTrigger>
                                <TabsTrigger value="new">Create New</TabsTrigger>
                            </TabsList>

                            <TabsContent value="existing" className="space-y-4 pt-4">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-medium border-b pb-2">Step 1: Select Patient</h3>
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search patients..."
                                            className="pl-8"
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                        />
                                    </div>

                                    <ScrollArea className="h-[200px] rounded-md border p-2">
                                        {filteredPatients.length === 0 ? (
                                            <p className="text-center text-muted-foreground py-8">No matching patients found</p>
                                        ) : (
                                            filteredPatients.map(p => (
                                                <div
                                                    key={p.id}
                                                    onClick={() => setSelectedTargetPatient(p.id)}
                                                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${selectedTargetPatient === p.id ? 'bg-primary/20 border border-primary/50' : 'hover:bg-muted'}`}
                                                >
                                                    <div>
                                                        <p className="font-medium text-sm">{p.name}</p>
                                                        <p className="text-xs text-muted-foreground">{p.dob} • {p.patientId}</p>
                                                    </div>
                                                    {selectedTargetPatient === p.id && <Badge variant="default" className="h-5">Selected</Badge>}
                                                </div>
                                            ))
                                        )}
                                    </ScrollArea>
                                </div>

                                {selectedTargetPatient && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                        <h3 className="text-sm font-medium border-b pb-2">Step 2: Assign Visit</h3>
                                        <div className="space-y-3">
                                            {visits.length > 0 && (
                                                <div
                                                    className={`p-3 rounded-lg border cursor-pointer ${visitMode === 'existing' ? 'bg-primary/5 border-primary/50' : 'hover:bg-muted'}`}
                                                    onClick={() => setVisitMode('existing')}
                                                >
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${visitMode === 'existing' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                            {visitMode === 'existing' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                        </div>
                                                        <span className="font-medium text-sm">Add to existing visit</span>
                                                    </div>
                                                    {visitMode === 'existing' && (
                                                        <ScrollArea className="h-[100px]">
                                                            <div className="space-y-1 ml-6">
                                                                {visits.map(v => (
                                                                    <div
                                                                        key={v.id}
                                                                        className={`p-2 rounded text-xs border cursor-pointer ${selectedVisitId === v.id ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted'}`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedVisitId(v.id);
                                                                        }}
                                                                    >
                                                                        <div className="font-medium">{v.interrogation_date}</div>
                                                                        <div className="opacity-80">{v.manufacturer} {v.device?.type || 'Device'}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </ScrollArea>
                                                    )}
                                                </div>
                                            )}

                                            <div
                                                className={`p-3 rounded-lg border cursor-pointer ${visitMode === 'new' ? 'bg-primary/5 border-primary/50' : 'hover:bg-muted'}`}
                                                onClick={() => setVisitMode('new')}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${visitMode === 'new' ? 'border-primary' : 'border-muted-foreground'}`}>
                                                        {visitMode === 'new' && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                    </div>
                                                    <span className="font-medium text-sm">Create new visit from date</span>
                                                </div>
                                                {visitMode === 'new' && (
                                                    <div className="ml-6 mt-3 max-w-xs" onClick={e => e.stopPropagation()}>
                                                        <Input
                                                            type="date"
                                                            value={newVisitDate}
                                                            onChange={e => setNewVisitDate(e.target.value)}
                                                        />
                                                    </div>
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
                                        <Label className="text-xs font-semibold">Visit Date (Required)</Label>
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
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setMoveFileModalOpen(false)}>Cancel</Button>
                        <Button onClick={confirmMove} disabled={
                            (activeMoveTab === 'existing' && (!selectedTargetPatient || (visitMode === 'existing' && !selectedVisitId) || (visitMode === 'new' && !newVisitDate))) ||
                            (activeMoveTab === 'new' && (!newPatient.last_name || !newPatient.dob || !newVisitDate))
                        }>
                            {activeMoveTab === 'new' ? 'Create & Move' : 'Confirm Move'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ImportHistory;

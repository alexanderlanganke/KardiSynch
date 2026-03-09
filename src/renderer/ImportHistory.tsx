import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { History, FileText, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';
import PatientAssignmentModal from '@/components/PatientAssignmentModal';
import { useAppDialog } from './components/AppDialogProvider';

const ImportHistory: React.FC = () => {
    const { showAlert, showConfirm } = useAppDialog();
    const [sessions, setSessions] = useState<any[]>([]);
    const [selectedSession, setSelectedSession] = useState<any | null>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Move File State
    const [moveFileModalOpen, setMoveFileModalOpen] = useState(false);
    const [fileToMove, setFileToMove] = useState<any | null>(null);
    const [previewPath, setPreviewPath] = useState<string | null>(null);

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

    const handleMoveClick = async (event: any) => {
        setFileToMove(event);
        // Resolve the actual path for preview
        try {
            const realPath = await window.electronAPI.getPreviewPath(event.file_path);
            setPreviewPath(realPath);
            setMoveFileModalOpen(true);
        } catch (e) {
            console.error('Failed to get preview path', e);
            showAlert('Original file could not be located.');
        }
    };

    const handleManualSortResolve = async (decision: any) => {
        if (!fileToMove) return;

        if (decision.action === 'unmatched') {
            setMoveFileModalOpen(false);
            return;
        }

        let finalPatientId = decision.patientId;

        try {
            if (decision.action === 'create-patient') {
                // Create patient first
                const res = await window.electronAPI.createPatient(decision.patientData);
                if (res && res.id) {
                    finalPatientId = res.id;
                } else {
                    showAlert('Failed to create patient: No ID returned.');
                    return;
                }
            }

            if (finalPatientId) {
                fileToMove.id,
                    finalPatientId,
                    decision.visitId, // might be undefined if creating new visit
                    decision.visitDate, // defined if new visit or new patient
                    previewPath || undefined // Pass the active preview path as confirmed source

                setMoveFileModalOpen(false);
                setFileToMove(null);
                setPreviewPath(null);
                // Refresh list
                if (selectedSession) {
                    handleSessionClick(selectedSession);
                }
            }
        } catch (e: any) {
            console.error('Failed to move file', e);
            showAlert(`Failed to complete action: ${e.message || e}`);
        }
    };

    // Construct fileInfo for ManualSortingModal
    const fileInfo = fileToMove ? {
        filename: fileToMove.file_path ? fileToMove.file_path.split(/[\\/]/).pop() : 'Unknown',
        tempPath: previewPath, // Use the resolved path
        previewData: {
            patientName: (fileToMove.first_name || '') + ' ' + (fileToMove.last_name || ''), // Best guess from event log if available
            dob: 'Unknown', // ImportEvent doesn't usually store extended extracted metadata unless in message?
            date: 'Unknown',
            serial: 'Unknown'
        }
    } : null;

    return (
        <div className="container mx-auto p-6 max-w-7xl h-full flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <History className="h-8 w-8 text-primary" />
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Import History</h1>
                        <p className="text-muted-foreground">View past import sessions and correct errors.</p>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button variant="outline" onClick={async () => {
                        if (await showConfirm('This will attempt to re-import all files currently in the Unmatched directory. Continue?')) {
                            const res = await window.electronAPI.reprocessUnmatched();
                            if (res.success) {
                                await showAlert(`Rescan initiated. ${res.count} files moved to processing queue.`);
                                loadHistory();
                            } else {
                                await showAlert('Failed to rescan: ' + res.message);
                            }
                        }
                    }}>
                        <History className="mr-2 h-4 w-4" /> Rescan Unmatched Files
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Session List */}
                <Card className="lg:col-span-1 flex flex-col min-h-0 bg-card">
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
                                            className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${selectedSession?.id === session.id ? 'border-primary bg-muted ring-1 ring-primary' : 'border-border hover:bg-muted'}`}
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
                <Card className="lg:col-span-2 flex flex-col min-h-0 bg-card">
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
                                                            {(event.first_name || '')} {(event.last_name || '')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground italic">{event.message}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {['imported', 'manually_sorted', 'unmatched', 'error'].includes((event.status || '').toLowerCase().trim()) && (
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

            {/* Replaced Dialog with PatientAssignmentModal */}
            {
                moveFileModalOpen && fileInfo && (
                    <PatientAssignmentModal
                        open={moveFileModalOpen}
                        mode="import"
                        sourceItem={fileInfo}
                        onResolve={handleManualSortResolve}
                        onCancel={() => setMoveFileModalOpen(false)}
                    />
                )
            }
        </div >
    );
};

export default ImportHistory;


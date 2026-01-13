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

const ManualSortingModal: React.FC<ManualSortingModalProps> = ({ open, fileInfo, onResolve }) => {
    const [activeTab, setActiveTab] = useState('existing');
    const [searchTerm, setSearchTerm] = useState('');
    const [patients, setPatients] = useState<Patient[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

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
                const { patientName, dob } = fileInfo.previewData;
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
            }
        }
    }, [open, fileInfo]);

    const filteredPatients = patients.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleAssign = () => {
        if (selectedPatientId) {
            onResolve({ action: 'assign-patient', patientId: selectedPatientId });
        }
    };

    const handleCreate = () => {
        if (newPatient.last_name && newPatient.dob) {
            onResolve({ action: 'create-patient', patientData: newPatient });
        }
    };

    const handleUnmatched = () => {
        onResolve({ action: 'unmatched' });
    };

    if (!fileInfo) return null;

    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-[700px] bg-background/95 backdrop-blur-xl border-primary/20">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <AlertCircle className="h-6 w-6 text-yellow-500" />
                        <span className="bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent">
                            Ambiguous File Detected
                        </span>
                    </DialogTitle>
                    <DialogDescription>
                        The system could not automatically match this file specific patient or visit. Please verify the details.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
                    {/* File Preview */}
                    <Card className="md:col-span-1 bg-muted/30 border-dashed border-2">
                        <CardContent className="p-4 space-y-4">
                            <div className="flex flex-col items-center justify-center p-4 bg-background/50 rounded-lg">
                                <FileText className="h-12 w-12 text-primary/70 mb-2" />
                                <p className="text-sm font-medium break-all text-center">{fileInfo.filename}</p>
                            </div>

                            <div className="space-y-2 text-sm">
                                <div>
                                    <span className="text-muted-foreground text-xs">Extracted Name</span>
                                    <p className="font-medium">{fileInfo.previewData?.patientName || 'Unknown'}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs">Extracted DOB</span>
                                    <p className="font-medium">{fileInfo.previewData?.dob || 'Unknown'}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs">Device Serial</span>
                                    <p className="font-medium font-mono">{fileInfo.previewData?.serial || 'Unknown'}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs">Date</span>
                                    <p className="font-medium">{fileInfo.previewData?.date ? fileInfo.previewData.date.split('T')[0] : 'Unknown'}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Action Area */}
                    <div className="md:col-span-2">
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

                                <ScrollArea className="h-[200px] rounded-md border p-2">
                                    {filteredPatients.length === 0 ? (
                                        <p className="text-center text-muted-foreground py-8">No matching patients found</p>
                                    ) : (
                                        filteredPatients.map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => setSelectedPatientId(p.id)}
                                                className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${selectedPatientId === p.id ? 'bg-primary/20 border border-primary/50' : 'hover:bg-muted'}`}
                                            >
                                                <div>
                                                    <p className="font-medium text-sm">{p.name}</p>
                                                    <p className="text-xs text-muted-foreground">{p.dob} • {p.patientId}</p>
                                                </div>
                                                {selectedPatientId === p.id && <Badge variant="default" className="h-5">Selected</Badge>}
                                            </div>
                                        ))
                                    )}
                                </ScrollArea>
                            </TabsContent>

                            <TabsContent value="new" className="space-y-4 pt-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>First Name</Label>
                                        <Input
                                            value={newPatient.first_name}
                                            onChange={e => setNewPatient({ ...newPatient, first_name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Last Name</Label>
                                        <Input
                                            value={newPatient.last_name}
                                            onChange={e => setNewPatient({ ...newPatient, last_name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Date of Birth</Label>
                                        <Input
                                            type="date"
                                            value={newPatient.dob}
                                            onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Hospital MRN</Label>
                                        <Input
                                            value={newPatient.hospitalPatientId}
                                            onChange={e => setNewPatient({ ...newPatient, hospitalPatientId: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                <DialogFooter className="flex sm:justify-between items-center gap-4">
                    <Button variant="ghost" onClick={handleUnmatched} className="text-muted-foreground hover:text-destructive">
                        I don't know (Skip)
                    </Button>
                    <div className="flex gap-2">
                        {activeTab === 'existing' ? (
                            <Button onClick={handleAssign} disabled={!selectedPatientId}>
                                Assign to Selected
                            </Button>
                        ) : (
                            <Button onClick={handleCreate} disabled={!newPatient.last_name || !newPatient.dob}>
                                <UserPlus className="mr-2 h-4 w-4" /> Create & Assign
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ManualSortingModal;

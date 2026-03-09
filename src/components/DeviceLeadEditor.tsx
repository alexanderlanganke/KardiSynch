import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Activity, Zap } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppDialog } from '@/renderer/components/AppDialogProvider';

// Types for our editor
interface Device {
    manufacturer: string;
    model: string;
    serial: string;
    implant_date: string;
    type?: string;
}

interface Lead {
    manufacturer: string;
    model: string;
    serial: string;
    implant_date: string;
    type?: string;
    connector?: string;
    position?: string;
}

interface PatientData {
    id: string;
    first_name: string;
    last_name: string;
    dob: string;
    hospitalPatientId: string;
    devices: Device[];
    leads: Lead[];
}

interface DeviceLeadEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    patient: PatientData;
    onSave: (data: PatientData) => Promise<void>;
}

const DeviceLeadEditor: React.FC<DeviceLeadEditorProps> = ({ open, onOpenChange, patient, onSave }) => {
    const { showAlert } = useAppDialog();
    const [formData, setFormData] = useState<PatientData>(patient);
    const [saving, setSaving] = useState(false);

    // Sync with prop when opened
    useEffect(() => {
        if (open) {
            setFormData(JSON.parse(JSON.stringify(patient))); // Deep copy
        }
    }, [open, patient]);

    const handleBasicChange = (field: keyof PatientData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleDeviceChange = (index: number, field: keyof Device, value: string) => {
        const newDevices = [...formData.devices];
        newDevices[index] = { ...newDevices[index], [field]: value };
        setFormData(prev => ({ ...prev, devices: newDevices }));
    };

    const handleLeadChange = (index: number, field: keyof Lead, value: string) => {
        const newLeads = [...formData.leads];
        newLeads[index] = { ...newLeads[index], [field]: value };
        setFormData(prev => ({ ...prev, leads: newLeads }));
    };

    const addDevice = () => {
        setFormData(prev => ({
            ...prev,
            devices: [...prev.devices, { manufacturer: '', model: '', serial: '', implant_date: '', type: 'Pacemaker' }]
        }));
    };

    const removeDevice = (index: number) => {
        setFormData(prev => ({
            ...prev,
            devices: prev.devices.filter((_, i) => i !== index)
        }));
    };

    const addLead = () => {
        setFormData(prev => ({
            ...prev,
            leads: [...prev.leads, { manufacturer: '', model: '', serial: '', implant_date: '', type: 'Bipolar', connector: 'IS-1' }]
        }));
    };

    const removeLead = (index: number) => {
        setFormData(prev => ({
            ...prev,
            leads: prev.leads.filter((_, i) => i !== index)
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(formData);
            onOpenChange(false);
        } catch (e) {
            console.error(e);
            showAlert('Failed to save changes');
        } finally {
            setSaving(false);
        }
    };

    const MANUFACTURERS = ['Medtronic', 'Biotronik', 'Boston Scientific', 'Abbott', 'Microport'];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-background">
                <DialogHeader className="px-6 py-4 border-b">
                    <DialogTitle>Edit Patient Record</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                        <div className="p-6 space-y-8">

                            {/* Basic Info Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Patient Information</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="fname">First Name</Label>
                                        <Input id="fname" value={formData.first_name} onChange={e => handleBasicChange('first_name', e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="lname">Last Name</Label>
                                        <Input id="lname" value={formData.last_name} onChange={e => handleBasicChange('last_name', e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="dob">Date of Birth</Label>
                                        <Input id="dob" value={formData.dob} onChange={e => handleBasicChange('dob', e.target.value)} placeholder="YYYY-MM-DD" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="mrn">MRN / ID</Label>
                                        <Input id="mrn" value={formData.hospitalPatientId || ''} onChange={e => handleBasicChange('hospitalPatientId', e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            {/* Devices Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                        <Activity className="h-4 w-4" /> Devices
                                    </h3>
                                    <Button size="sm" variant="outline" onClick={addDevice}><Plus className="h-3 w-3 mr-1" /> Add Device</Button>
                                </div>

                                <div className="space-y-3">
                                    {formData.devices.map((device, idx) => (
                                        <div key={idx} className="p-4 border rounded-lg bg-card relative group">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => removeDevice(idx)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>

                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Manufacturer</Label>
                                                    <Select value={device.manufacturer} onValueChange={(v) => handleDeviceChange(idx, 'manufacturer', v)}>
                                                        <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                                                        <SelectContent>
                                                            {MANUFACTURERS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Model</Label>
                                                    <Input className="h-8" value={device.model} onChange={e => handleDeviceChange(idx, 'model', e.target.value)} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Serial</Label>
                                                    <Input className="h-8 font-mono" value={device.serial} onChange={e => handleDeviceChange(idx, 'serial', e.target.value)} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Implant Date</Label>
                                                    <Input className="h-8" value={device.implant_date} onChange={e => handleDeviceChange(idx, 'implant_date', e.target.value)} placeholder="YYYY-MM-DD" />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Type</Label>
                                                    <Input className="h-8" value={device.type} onChange={e => handleDeviceChange(idx, 'type', e.target.value)} placeholder="Pacemaker/ICD" />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {formData.devices.length === 0 && <div className="text-sm text-muted-foreground text-center py-4 italic">No devices recorded</div>}
                                </div>
                            </div>

                            {/* Leads Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                        <Zap className="h-4 w-4" /> Leads
                                    </h3>
                                    <Button size="sm" variant="outline" onClick={addLead}><Plus className="h-3 w-3 mr-1" /> Add Lead</Button>
                                </div>

                                <div className="space-y-3">
                                    {formData.leads.map((lead, idx) => (
                                        <div key={idx} className="p-4 border rounded-lg bg-card relative group">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => removeLead(idx)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>

                                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Manufacturer</Label>
                                                    <Select value={lead.manufacturer} onValueChange={(v) => handleLeadChange(idx, 'manufacturer', v)}>
                                                        <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                                                        <SelectContent>
                                                            {MANUFACTURERS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Model</Label>
                                                    <Input className="h-8" value={lead.model} onChange={e => handleLeadChange(idx, 'model', e.target.value)} />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Serial</Label>
                                                    <Input className="h-8 font-mono" value={lead.serial} onChange={e => handleLeadChange(idx, 'serial', e.target.value)} />
                                                </div>
                                                {/* New Fields */}
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Type</Label>
                                                    <Select value={lead.type} onValueChange={(v) => handleLeadChange(idx, 'type', v)}>
                                                        <SelectTrigger className="h-8"><SelectValue placeholder="Type" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="Unipolar">Unipolar</SelectItem>
                                                            <SelectItem value="Bipolar">Bipolar</SelectItem>
                                                            <SelectItem value="Quadripolar">Quadripolar</SelectItem>
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Connector</Label>
                                                    <Select value={lead.connector} onValueChange={(v) => handleLeadChange(idx, 'connector', v)}>
                                                        <SelectTrigger className="h-8"><SelectValue placeholder="Conn" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="IS-1">IS-1</SelectItem>
                                                            <SelectItem value="DF-1">DF-1</SelectItem>
                                                            <SelectItem value="DF-4">DF-4</SelectItem>
                                                            <SelectItem value="IS-4">IS-4</SelectItem>
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Implant Date</Label>
                                                    <Input className="h-8" value={lead.implant_date} onChange={e => handleLeadChange(idx, 'implant_date', e.target.value)} placeholder="YYYY-MM-DD" />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {formData.leads.length === 0 && <div className="text-sm text-muted-foreground text-center py-4 italic">No leads recorded</div>}
                                </div>
                            </div>

                        </div>
                    </ScrollArea>
                </div>

                <DialogFooter className="px-6 py-4 border-t bg-muted flex justify-between">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default DeviceLeadEditor;

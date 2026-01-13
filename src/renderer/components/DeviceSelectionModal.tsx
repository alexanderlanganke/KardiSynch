import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Check, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DeviceData {
    manufacturer: string;
    type: string;
    model: string;
    serial: string;
    leads: { name: string; model: string; serial: string }[];
}

interface DeviceSelectionModalProps {
    open: boolean;
    fileInfo: any;
    onResolve: (result: { action: 'save' | 'skip'; deviceData?: DeviceData }) => void;
}

const DeviceSelectionModal: React.FC<DeviceSelectionModalProps> = ({ open, fileInfo, onResolve }) => {
    const [manufacturer, setManufacturer] = useState('');
    const [type, setType] = useState('');
    const [model, setModel] = useState('');
    const [serial, setSerial] = useState('');

    const [leads, setLeads] = useState([
        { name: 'RA', model: '', serial: '' },
        { name: 'RV', model: '', serial: '' },
        { name: 'LV', model: '', serial: '' }
    ]);

    useEffect(() => {
        if (open && fileInfo?.previewData) {
            // Pre-fill if we have partial data
            const { manufacturer: m, device } = fileInfo.previewData;
            if (m && m !== 'Unknown') setManufacturer(m);
            if (device) {
                if (device.type && device.type !== 'Unknown') setType(device.type);
                if (device.model && device.model !== 'Unknown') setModel(device.model);
                if (device.serial_number && device.serial_number !== 'Unknown') setSerial(device.serial_number);
            }
        } else {
            // Reset
            setManufacturer('');
            setType('');
            setModel('');
            setSerial('');
            setLeads([
                { name: 'RA', model: '', serial: '' },
                { name: 'RV', model: '', serial: '' },
                { name: 'LV', model: '', serial: '' }
            ]);
        }
    }, [open, fileInfo]);

    const handleLeadChange = (index: number, field: 'model' | 'serial', value: string) => {
        const newLeads = [...leads];
        newLeads[index][field] = value;
        setLeads(newLeads);
    };

    const handleSave = () => {
        // Filter out empty leads
        const activeLeads = leads.filter(l => l.model || l.serial);
        onResolve({
            action: 'save',
            deviceData: {
                manufacturer,
                type,
                model,
                serial,
                leads: activeLeads
            }
        });
    };

    const handleSkip = () => {
        onResolve({ action: 'skip' });
    };

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-[700px] bg-background/95 backdrop-blur-xl border-primary/20">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Settings className="h-6 w-6 text-blue-500" />
                        <span className="bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
                            Device Autodetection Failed
                        </span>
                    </DialogTitle>
                    <DialogDescription>
                        The system could not identify the device details from file:
                        <span className="font-mono text-xs ml-1 bg-muted px-1 rounded">{fileInfo?.filename}</span>.
                        Please manually select the device parameters.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Manufacturer *</Label>
                            <Select value={manufacturer} onValueChange={setManufacturer}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Manufacturer" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Biotronik">Biotronik</SelectItem>
                                    <SelectItem value="Medtronic">Medtronic</SelectItem>
                                    <SelectItem value="Boston Scientific">Boston Scientific</SelectItem>
                                    <SelectItem value="Abbott">Abbott</SelectItem>
                                    <SelectItem value="Microport">Microport</SelectItem>
                                    <SelectItem value="Sorin">Sorin</SelectItem>
                                    <SelectItem value="Impulse Dynamics">Impulse Dynamics</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Device Type *</Label>
                            <Select value={type} onValueChange={setType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Pacemaker">Pacemaker</SelectItem>
                                    <SelectItem value="ICD">ICD</SelectItem>
                                    <SelectItem value="CRT-P">CRT-P</SelectItem>
                                    <SelectItem value="CRT-D">CRT-D</SelectItem>
                                    <SelectItem value="ICM">ICM / Loop Recorder</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Device Model</Label>
                            <Input
                                placeholder="e.g. Edora 8"
                                value={model}
                                onChange={e => setModel(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Serial Number</Label>
                            <Input
                                placeholder="e.g. 12345678"
                                value={serial}
                                onChange={e => setSerial(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Lead Information (Optional)</Label>
                        <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
                            {leads.map((lead, idx) => (
                                <div key={lead.name} className="flex gap-2 items-center">
                                    <div className="w-12 font-medium text-sm text-center bg-muted/50 rounded py-1">{lead.name}</div>
                                    <Input
                                        placeholder="Model"
                                        className="h-8 text-xs"
                                        value={lead.model}
                                        onChange={e => handleLeadChange(idx, 'model', e.target.value)}
                                    />
                                    <Input
                                        placeholder="Serial"
                                        className="h-8 text-xs"
                                        value={lead.serial}
                                        onChange={e => handleLeadChange(idx, 'serial', e.target.value)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                <DialogFooter className="flex sm:justify-between items-center gap-4">
                    <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground hover:text-destructive">
                        Skip (Import as Unknown)
                    </Button>
                    <Button onClick={handleSave} disabled={!manufacturer || !type}>
                        <Check className="mr-2 h-4 w-4" /> Save Details
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default DeviceSelectionModal;

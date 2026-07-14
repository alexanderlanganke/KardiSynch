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

import ReportViewer from '@/components/ReportViewer';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

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
            const { manufacturer: m, device, leads: parsedLeads } = fileInfo.previewData;
            if (m && m !== 'Unknown') setManufacturer(m);
            if (device) {
                if (device.type && device.type !== 'Unknown') setType(device.type);
                if (device.model && device.model !== 'Unknown') setModel(device.model);
                if (device.serial_number && device.serial_number !== 'Unknown') setSerial(device.serial_number);
            }
            // Pre-fill leads from parsed data
            if (parsedLeads && Array.isArray(parsedLeads) && parsedLeads.length > 0) {
                const defaultNames = ['RA', 'RV', 'LV', 'HIS', 'CS'];
                const prefilled = parsedLeads.map((l: any, i: number) => ({
                    name: l.name || l.anatomic_location || defaultNames[i] || `Lead ${i + 1}`,
                    model: l.model && l.model !== 'Unknown' ? l.model : '',
                    serial: l.serial && l.serial !== 'Unknown' && l.serial !== '.' ? l.serial : '',
                }));
                // Pad to at least 3 rows so the user can add more
                while (prefilled.length < 3) {
                    prefilled.push({ name: defaultNames[prefilled.length] || `Lead ${prefilled.length + 1}`, model: '', serial: '' });
                }
                setLeads(prefilled);
            } else {
                setLeads([
                    { name: 'RA', model: '', serial: '' },
                    { name: 'RV', model: '', serial: '' },
                    { name: 'LV', model: '', serial: '' }
                ]);
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

    const isPdf = fileInfo.filename?.toLowerCase().endsWith('.pdf');

    return (
        // Closing via ESC / the injected X must not leave the watcher waiting for
        // a response — treat any dismiss as the explicit "Skip" action.
        <Dialog open={open} onOpenChange={(val) => { if (!val) handleSkip(); }}>
            <DialogContent className="max-w-[90vw] w-[1200px] h-[85vh] flex flex-col bg-background border-border p-0 overflow-hidden">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="px-6 py-4 border-b shrink-0">
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Settings className="h-6 w-6 text-blue-500" />
                            <span className="text-foreground">
                                Device Autodetection Failed
                            </span>
                        </DialogTitle>
                        <DialogDescription className="mt-1">
                            The system could not identify device details. Please transcribe them from the document.
                        </DialogDescription>
                    </div>

                    <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0">
                        {/* LEFT PANE: Inputs (4 columns) */}
                        <div className="col-span-4 border-r flex flex-col bg-muted h-full overflow-hidden">
                            <ScrollArea className="flex-1">
                                <div className="p-6 space-y-6">
                                    <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                                        <FileText className="h-8 w-8 text-primary/70" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate" title={fileInfo.filename}>{fileInfo.filename}</p>
                                            <Badge variant="outline" className="text-[10px] h-5 px-1 mt-1">
                                                {isPdf ? 'PDF Document' : 'Unknown Type'}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 gap-4">
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

                                        <div className="grid grid-cols-1 gap-4">
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

                                        <div className="space-y-2 pt-2 border-t">
                                            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Leads</Label>
                                            <div className="space-y-3">
                                                {leads.map((lead, idx) => (
                                                    <div key={lead.name} className="flex gap-2 items-center">
                                                        <div className="w-8 shrink-0 font-medium text-xs text-center bg-muted rounded py-1">{lead.name}</div>
                                                        <Input
                                                            placeholder="Model"
                                                            className="h-8 text-xs flex-1"
                                                            value={lead.model}
                                                            onChange={e => handleLeadChange(idx, 'model', e.target.value)}
                                                        />
                                                        <Input
                                                            placeholder="Serial"
                                                            className="h-8 text-xs flex-1"
                                                            value={lead.serial}
                                                            onChange={e => handleLeadChange(idx, 'serial', e.target.value)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>

                            <div className="p-4 border-t bg-background shrink-0 flex flex-col gap-3">
                                <Button onClick={handleSave} disabled={!manufacturer || !type} className="w-full">
                                    <Check className="mr-2 h-4 w-4" /> Save Details
                                </Button>
                                <Button variant="ghost" onClick={handleSkip} className="w-full text-muted-foreground hover:text-destructive text-xs">
                                    Skip (Import as Unknown)
                                </Button>
                            </div>
                        </div>

                        {/* RIGHT PANE: Preview (8 columns) */}
                        <div className="col-span-8 h-full bg-muted flex flex-col relative overflow-hidden">
                            <div className="absolute inset-0 p-4">
                                <div className="h-full w-full rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col">
                                    <div className="px-4 py-2 border-b bg-muted text-xs font-medium text-muted-foreground flex justify-between items-center">
                                        <span>Document Preview</span>
                                        {isPdf && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px]">PDF Viewer</span>}
                                    </div>
                                    <div className="flex-1 bg-gray-50 overflow-auto relative flex items-center justify-center">
                                        {fileInfo.tempPath ? (
                                            <div className="w-full h-full">
                                                <ReportViewer
                                                    report={null}
                                                    type={isPdf ? 'pdf' : 'text'} // Fallback to text if not PDF (assuming auto-detection)
                                                    filePath={fileInfo.tempPath}
                                                />
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
        </Dialog>
    );
};

export default DeviceSelectionModal;

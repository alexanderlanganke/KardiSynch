import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { GitMerge, ArrowRight, Check, X } from 'lucide-react';

interface DataMergeModalProps {
    open: boolean;
    currentPatient: any;
    scannedData: any;
    onConfirm: (mergedData: any) => void;
    onCancel: () => void;
}

const DataMergeModal: React.FC<DataMergeModalProps> = ({ open, currentPatient, scannedData, onConfirm, onCancel }) => {
    // Track which fields to overwrite. Key matches the data structure paths.
    // 'demographics': Name, DOB, ID
    // 'device': Model, Serial, Manufacturer
    // 'leads': All leads
    const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());

    // Helper to toggle
    const toggle = (key: string) => {
        const next = new Set(selectedSections);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelectedSections(next);
    };

    // Construct merged data based on selections
    const handleConfirm = () => {
        const merged = { ...currentPatient };

        if (selectedSections.has('demographics')) {
            if (scannedData.patient) {
                merged.first_name = scannedData.patient.first_name || merged.first_name;
                merged.last_name = scannedData.patient.last_name || merged.last_name;
                merged.dob = scannedData.patient.dob || merged.dob;
                merged.hospitalPatientId = scannedData.patient.hospitalPatientId || merged.hospitalPatientId;
                // Update full name display helper if exists
                merged.name = `${merged.first_name} ${merged.last_name}`;
            }
        }

        if (selectedSections.has('device')) {
            if (scannedData.device) {
                // We typically update the device history array or the "current" device fields
                // The DB update logic expects devices array usually.
                // Or flat fields?
                // The `update-patient` IPC expects: { ...patient, devices: [...], leads: [...] }
                // Let's assume we prepend/update the devices list.
                // For simplicity, we'll constructed a "current device" update.
                // But honestly, the user probably just wants to ensure this device is in the list.

                // Let's REPLACE the devices list? No, that's dangerous.
                // Let's PREPEND the scanned device to the list (making it active).
                const newDevice = {
                    manufacturer: scannedData.device.manufacturer,
                    model: scannedData.device.model,
                    serial: scannedData.device.serial,
                    type: scannedData.device.type
                };

                // Remove duplicates if exists
                const existing = (merged.devices || []).filter((d: any) => d.serial !== newDevice.serial);
                merged.devices = [newDevice, ...existing];
            }
        }

        if (selectedSections.has('leads')) {
            if (scannedData.leads && scannedData.leads.length > 0) {
                // Replace leads list or merge?
                // Usually a visit defines the current leads configuration.
                // We'll replace the current leads with the scanned ones (as they are "current status").
                merged.leads = scannedData.leads;
            }
        }

        onConfirm(merged);
    };

    if (!scannedData || !currentPatient) return null;

    // Changes detection
    const demoDiffers =
        (scannedData.patient?.first_name && scannedData.patient.first_name !== currentPatient.first_name) ||
        (scannedData.patient?.last_name && scannedData.patient.last_name !== currentPatient.last_name) ||
        (scannedData.patient?.dob && scannedData.patient.dob !== currentPatient.dob);

    const deviceDiffers = scannedData.device && (
        !currentPatient.devices?.[0] ||
        currentPatient.devices[0].serial !== scannedData.device.serial
    );

    // Leads differ if counts differ or serials differ
    const currentLeads = currentPatient.leads || [];
    const scannedLeads = scannedData.leads || [];
    const leadsDiffers = currentLeads.length !== scannedLeads.length ||
        scannedLeads.some((l: any, i: number) => currentLeads[i]?.serial !== l.serial);

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <GitMerge className="h-5 w-5 text-primary" />
                        Confirm Data Updates
                    </DialogTitle>
                </DialogHeader>

                <div className="py-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">Select</TableHead>
                                <TableHead>Data Section</TableHead>
                                <TableHead>Current Value</TableHead>
                                <TableHead></TableHead>
                                <TableHead>New Value (From Scan)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Demographics Row */}
                            <TableRow className={demoDiffers ? 'bg-orange-500/5' : ''}>
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={selectedSections.has('demographics')}
                                        onChange={() => toggle('demographics')}
                                        disabled={!demoDiffers}
                                    />
                                </TableCell>
                                <TableCell className="font-medium">
                                    Patient Demographics
                                    {demoDiffers && <Badge variant="outline" className="ml-2 text-[10px] text-orange-600 border-orange-200">Differs</Badge>}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                    <div>{currentPatient.first_name} {currentPatient.last_name}</div>
                                    <div className="text-xs">{currentPatient.dob}</div>
                                </TableCell>
                                <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground/30" /></TableCell>
                                <TableCell className="font-semibold text-sm">
                                    {scannedData.patient ? (
                                        <>
                                            <div>{scannedData.patient.first_name} {scannedData.patient.last_name}</div>
                                            <div className="text-xs">{scannedData.patient.dob}</div>
                                        </>
                                    ) : <span className="text-muted-foreground italic">No data</span>}
                                </TableCell>
                            </TableRow>

                            {/* Device Row */}
                            <TableRow className={deviceDiffers ? 'bg-blue-500/5' : ''}>
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={selectedSections.has('device')}
                                        onChange={() => toggle('device')}
                                        disabled={!scannedData.device}
                                    />
                                </TableCell>
                                <TableCell className="font-medium">
                                    Implantable Device
                                    {deviceDiffers && <Badge variant="outline" className="ml-2 text-[10px] text-blue-600 border-blue-200">New</Badge>}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                    {currentPatient.devices?.[0] ? (
                                        <>
                                            <div>{currentPatient.devices[0].model}</div>
                                            <div className="text-xs font-mono">{currentPatient.devices[0].serial}</div>
                                        </>
                                    ) : <span className="italic">None</span>}
                                </TableCell>
                                <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground/30" /></TableCell>
                                <TableCell className="font-semibold text-sm">
                                    {scannedData.device ? (
                                        <>
                                            <div>{scannedData.device.model}</div>
                                            <div className="text-xs font-mono">{scannedData.device.serial}</div>
                                        </>
                                    ) : <span className="text-muted-foreground italic">No data</span>}
                                </TableCell>
                            </TableRow>

                            {/* Leads Row */}
                            <TableRow className={leadsDiffers ? 'bg-purple-500/5' : ''}>
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={selectedSections.has('leads')}
                                        onChange={() => toggle('leads')}
                                        disabled={!scannedData.leads?.length}
                                    />
                                </TableCell>
                                <TableCell className="font-medium">
                                    Leads Configuration
                                    {leadsDiffers && <Badge variant="outline" className="ml-2 text-[10px] text-purple-600 border-purple-200">Differs</Badge>}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                    <div className="space-y-1">
                                        {currentLeads.length > 0 ? currentLeads.map((l: any, i: number) => (
                                            <div key={i} className="text-xs">{l.model} ({l.serial})</div>
                                        )) : <span className="italic">None</span>}
                                    </div>
                                </TableCell>
                                <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground/30" /></TableCell>
                                <TableCell className="font-semibold text-sm">
                                    <div className="space-y-1">
                                        {scannedData.leads?.length > 0 ? scannedData.leads.map((l: any, i: number) => (
                                            <div key={i} className="text-xs">{l.model} ({l.serial})</div>
                                        )) : <span className="text-muted-foreground italic">No leads found</span>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onCancel}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={selectedSections.size === 0}>
                        <Check className="mr-2 h-4 w-4" />
                        Merge & Update Selected
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default DataMergeModal;

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Activity, Battery, Zap, Heart } from 'lucide-react';

interface ReportViewerProps {
    report: any;
    type: 'xml' | 'pdf' | 'image';
    filePath?: string;
}

const ReportViewer: React.FC<ReportViewerProps> = ({ report, type, filePath }) => {
    if (type === 'xml' && report) {
        return <BiotronikDataViewer data={report} />;
    }

    if (type === 'pdf' && filePath) {
        return <PDFViewer filePath={filePath} />;
    }

    if (type === 'image' && filePath) {
        return <ImageViewer filePath={filePath} />;
    }

    return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
            No data available
        </div>
    );
};

// Biotronik XML Data Viewer
const BiotronikDataViewer: React.FC<{ data: any }> = ({ data }) => {
    return (
        <div className="space-y-6 p-6 overflow-auto h-full">
            {/* Device Info */}
            {data.device && (
                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            Device Information
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-muted-foreground">Type</div>
                            <div className="font-medium">{data.device.type || 'N/A'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Model</div>
                            <div className="font-medium">{data.device.model || 'N/A'}</div>
                        </div>
                        <div className="col-span-2">
                            <div className="text-xs text-muted-foreground">Serial Number</div>
                            <div className="font-mono text-sm">{data.device.serial_number || 'N/A'}</div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Battery */}
            {data.battery && (
                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Battery className="h-5 w-5" />
                            Battery Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-4">
                        <div>
                            <div className="text-xs text-muted-foreground">Voltage</div>
                            <div className="font-medium">
                                {data.battery.voltage?.value} {data.battery.voltage?.unit}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Remaining</div>
                            <div className="font-medium">
                                {data.battery.remaining_longevity?.value} {data.battery.remaining_longevity?.unit}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Status</div>
                            <Badge variant="secondary">{data.battery.status || 'Unknown'}</Badge>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Leads */}
            {data.leads && data.leads.length > 0 && (
                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Zap className="h-5 w-5" />
                            Lead Parameters
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {data.leads.map((lead: any, idx: number) => (
                            <div key={idx} className="border-l-2 border-primary/20 pl-4">
                                <div className="font-medium mb-2">{lead.name}</div>
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                    <div>
                                        <div className="text-xs text-muted-foreground">Threshold</div>
                                        <div>{lead.pacing_threshold?.value}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Sensing</div>
                                        <div>
                                            {lead.sensing?.value} {lead.sensing?.unit}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Impedance</div>
                                        <div>
                                            {lead.impedance?.value} {lead.impedance?.unit}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Arrhythmia Summary */}
            {data.arrhythmia_summary && (
                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Heart className="h-5 w-5" />
                            Arrhythmia Summary
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4">
                        {data.arrhythmia_summary.atrial_fibrillation_burden && (
                            <div>
                                <div className="text-xs text-muted-foreground">AF Burden</div>
                                <div className="font-medium">
                                    {data.arrhythmia_summary.atrial_fibrillation_burden.value}{' '}
                                    {data.arrhythmia_summary.atrial_fibrillation_burden.unit}
                                </div>
                            </div>
                        )}
                        {data.arrhythmia_summary.ventricular_tachycardia_episodes !== undefined && (
                            <div>
                                <div className="text-xs text-muted-foreground">VT Episodes</div>
                                <div className="font-medium">{data.arrhythmia_summary.ventricular_tachycardia_episodes}</div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

// PDF Viewer (placeholder - will implement with react-pdf)
const PDFViewer: React.FC<{ filePath: string }> = ({ filePath }) => {
    return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
            <div>
                <p>PDF Viewer</p>
                <p className="text-xs">{filePath}</p>
                <p className="text-xs mt-2">Coming soon...</p>
            </div>
        </div>
    );
};

// Image Viewer
const ImageViewer: React.FC<{ filePath: string }> = ({ filePath }) => {
    return (
        <div className="flex items-center justify-center h-full p-4">
            <img
                src={`file://${filePath}`}
                alt="Report"
                className="max-w-full max-h-full object-contain"
            />
        </div>
    );
};

export default ReportViewer;

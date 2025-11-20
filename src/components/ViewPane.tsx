import React, { useState } from 'react';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import ReportViewer from './ReportViewer';
import { FileText, X } from 'lucide-react';
import { Button } from './ui/button';

interface ViewPaneProps {
    paneId: number;
    selectedReport: any | null;
    availableReports: any[];
    onReportSelect: (paneId: number, report: any | null) => void;
}

const ViewPane: React.FC<ViewPaneProps> = ({
    paneId,
    selectedReport,
    availableReports,
    onReportSelect,
}) => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const visitId = e.dataTransfer.getData('visitId');
        if (visitId) {
            const report = availableReports.find(r => r.id === visitId);
            if (report) {
                onReportSelect(paneId, report);
            }
        }
    };

    const handleClear = () => {
        onReportSelect(paneId, null);
    };

    return (
        <div
            className={`flex flex-col h-full border-r border-border last:border-r-0 transition-colors ${isDragOver ? 'bg-primary/5' : ''
                }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Header with file selector */}
            <div className="p-3 border-b border-border bg-card/50 flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Select
                    value={selectedReport?.id || ''}
                    onValueChange={(value) => {
                        if (value === '') {
                            onReportSelect(paneId, null);
                        } else {
                            const report = availableReports.find(r => r.id === value);
                            onReportSelect(paneId, report || null);
                        }
                    }}
                >
                    <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Select a report..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {availableReports.map((report) => (
                            <SelectItem key={report.id} value={report.id}>
                                {new Date(report.interrogation_date).toLocaleDateString()} - {report.manufacturer}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {selectedReport && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={handleClear}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-auto relative">
                {selectedReport ? (
                    <ReportViewer report={selectedReport} type="xml" />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <div className="text-6xl mb-4 opacity-20">📊</div>
                        <div className="text-sm">Drag a visit here or select from dropdown</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ViewPane;

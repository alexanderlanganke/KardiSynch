import React, { useState } from 'react';
import { ErrorBoundary } from '../renderer/components/ErrorBoundary';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import ReportViewer from './ReportViewer';
import FormattedReport from '@/renderer/components/FormattedReport';
import { FileText, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface ViewPaneProps {
    paneId: number;
    patientId: string;
    selectedReport: any | null;
    availableReports: any[];
    onReportSelect: (paneId: number, report: any | null) => void;
    isActive: boolean;
    onActivate: () => void;
}

const ViewPane: React.FC<ViewPaneProps> = ({
    paneId,
    patientId,
    selectedReport,
    availableReports,
    onReportSelect,
    isActive,
    onActivate,
}) => {
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [availableFiles, setAvailableFiles] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isControlsExpanded, setIsControlsExpanded] = useState(true);
    const [viewMode, setViewMode] = useState<'raw' | 'formatted'>('raw');

    // Fetch files when selected report changes
    React.useEffect(() => {
        const loadFiles = async () => {
            if (selectedReport && selectedReport.directoryName) {
                try {
                    const files = await window.electronAPI.getVisitFiles(patientId, selectedReport.directoryName);
                    const safeFiles = Array.isArray(files) ? files : [];
                    setAvailableFiles(safeFiles);

                    if (safeFiles.length > 0 && !selectedFile) {
                        setSelectedFile(getBestFile(safeFiles));
                    }
                } catch (error) {
                    console.error('Failed to load visit files:', error);
                    setAvailableFiles([]);
                }
            } else {
                setAvailableFiles([]);
                setSelectedFile(null);
            }
        };
        loadFiles();
    }, [selectedReport, patientId]);

    const getBestFile = (files: string[]) => {
        const xmlFile = files.find((f: string) => f.toLowerCase().endsWith('.xml'));
        const pdfFile = files.find((f: string) => f.toLowerCase().endsWith('.pdf'));
        return xmlFile || pdfFile || files[0];
    };

    const effectiveSelectedFile = selectedFile || (availableFiles.length > 0 ? getBestFile(availableFiles) : null);

    React.useEffect(() => {
        if (availableFiles.length > 0 && !selectedFile) {
            setSelectedFile(getBestFile(availableFiles));
        } else if (!selectedReport) {
            setSelectedFile(null);
            setIsControlsExpanded(true);
        }
    }, [availableFiles, selectedFile, selectedReport]);

    React.useEffect(() => {
        if (effectiveSelectedFile) {
            setIsControlsExpanded(false);
        }
    }, [effectiveSelectedFile]);

    // Keyboard Navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isActive || !availableFiles.length) return;

            if (e.key === 'ArrowLeft') {
                cycleFile('prev');
            } else if (e.key === 'ArrowRight') {
                cycleFile('next');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, availableFiles, effectiveSelectedFile]);

    const cycleFile = (direction: 'next' | 'prev') => {
        if (!availableFiles.length || !effectiveSelectedFile) return;

        const currentIndex = availableFiles.indexOf(effectiveSelectedFile);
        if (currentIndex === -1) return;

        let newIndex;
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % availableFiles.length;
        } else {
            newIndex = (currentIndex - 1 + availableFiles.length) % availableFiles.length;
        }

        setSelectedFile(availableFiles[newIndex]);
    };

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
        setViewMode('raw');
    };

    const getFileType = (filePath: string): 'xml' | 'pdf' | 'image' => {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.xml')) return 'xml';
        if (lower.endsWith('.pdf')) return 'pdf';
        if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
        return 'xml';
    };

    // Find previous report for trend comparison
    const previousReport = React.useMemo(() => {
        if (!selectedReport || !availableReports.length) return undefined;
        const currentIdx = availableReports.findIndex(r => r.id === selectedReport.id);
        if (currentIdx >= 0 && currentIdx < availableReports.length - 1) {
            return availableReports[currentIdx + 1];
        }
        return undefined;
    }, [selectedReport, availableReports]);

    return (
        <div
            className={cn(
                "flex flex-col h-full border-r border-border last:border-r-0 transition-all duration-200",
                isDragOver && 'bg-primary/5',
                isActive && 'ring-2 ring-inset ring-primary/20'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={onActivate}
        >
            {/* Header with file selector */}
            <div className="border-b border-border bg-card/50 flex flex-col transition-all duration-300 ease-in-out">
                {/* Collapsed Summary Bar */}
                {!isControlsExpanded && selectedReport && (
                    <div
                        className="flex items-center justify-between p-2 cursor-pointer hover:bg-accent/50 group"
                        onClick={() => setIsControlsExpanded(true)}
                    >
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1 min-w-0">
                            <FileText className="h-3 w-3 flex-shrink-0" />
                            <span className="font-medium text-foreground whitespace-nowrap">
                                {new Date(selectedReport.interrogation_date).toLocaleDateString()}
                            </span>
                            <span>-</span>
                            <span className="whitespace-nowrap">{selectedReport.manufacturer}</span>
                            {effectiveSelectedFile && viewMode === 'raw' && (
                                <>
                                    <span>-</span>
                                    <span className="truncate max-w-[150px]">
                                        {effectiveSelectedFile.split(/[/\\]/).pop()}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {/* View Mode Toggle */}
                            <div className="flex items-center bg-muted/50 rounded-md p-0.5 mr-1">
                                <button
                                    className={cn(
                                        "px-2 py-0.5 text-[10px] rounded transition-colors",
                                        viewMode === 'raw' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                    onClick={(e) => { e.stopPropagation(); setViewMode('raw'); }}
                                    aria-label="Raw view"
                                >
                                    Raw
                                </button>
                                <button
                                    className={cn(
                                        "px-2 py-0.5 text-[10px] rounded transition-colors",
                                        viewMode === 'formatted' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                    onClick={(e) => { e.stopPropagation(); setViewMode('formatted'); }}
                                    aria-label="Formatted view"
                                >
                                    Formatted
                                </button>
                            </div>

                            {availableFiles.length > 1 && viewMode === 'raw' && (
                                <>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); cycleFile('prev'); }} title="Previous Document">
                                        <ChevronLeft className="h-3 w-3" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); cycleFile('next'); }} title="Next Document">
                                        <ChevronRight className="h-3 w-3" />
                                    </Button>
                                    <div className="w-px h-3 bg-border mx-1" />
                                </>
                            )}
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                <ChevronDown className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Expanded Controls */}
                {(isControlsExpanded || !selectedReport) && (
                    <div className="p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <Select
                                value={selectedReport?.id || 'none'}
                                onValueChange={(value) => {
                                    if (value === 'none') {
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
                                    <SelectItem value="none">None</SelectItem>
                                    {availableReports.map((report) => (
                                        <SelectItem key={report.id} value={report.id}>
                                            {new Date(report.interrogation_date).toLocaleDateString()} - {report.manufacturer}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* View Mode Toggle */}
                            {selectedReport && (
                                <div className="flex items-center bg-muted/50 rounded-md p-0.5">
                                    <button
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded transition-colors",
                                            viewMode === 'raw' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                        )}
                                        onClick={() => setViewMode('raw')}
                                        aria-label="Raw view"
                                    >
                                        Raw
                                    </button>
                                    <button
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded transition-colors",
                                            viewMode === 'formatted' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                        )}
                                        onClick={() => setViewMode('formatted')}
                                        aria-label="Formatted view"
                                    >
                                        Formatted
                                    </button>
                                </div>
                            )}

                            {selectedReport && (
                                <>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleClear} title="Clear Selection">
                                        <X className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setIsControlsExpanded(false)} title="Collapse Controls">
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>

                        {/* File Selector (only in raw mode) */}
                        {selectedReport && availableFiles.length > 0 && viewMode === 'raw' && (
                            <div className="flex items-center gap-2 pl-6">
                                <span className="text-xs text-muted-foreground">File:</span>
                                <Select value={effectiveSelectedFile || ''} onValueChange={setSelectedFile}>
                                    <SelectTrigger className="h-7 text-xs flex-1">
                                        <SelectValue placeholder="Select file" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableFiles.map((file: string, idx: number) => {
                                            const fileName = file.split(/[/\\]/).pop();
                                            return (
                                                <SelectItem key={idx} value={file}>{fileName}</SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                {availableFiles.length > 1 && (
                                    <div className="flex items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cycleFile('prev')} title="Previous Document">
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cycleFile('next')} title="Next Document">
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-hidden relative flex flex-col">
                {selectedReport ? (
                    viewMode === 'formatted' ? (
                        <FormattedReport report={selectedReport} previousReport={previousReport} />
                    ) : (
                        <ErrorBoundary>
                            <ReportViewer
                                report={selectedReport}
                                type={effectiveSelectedFile ? getFileType(effectiveSelectedFile) : 'xml'}
                                filePath={effectiveSelectedFile || undefined}
                            />
                        </ErrorBoundary>
                    )
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <FileText className="h-12 w-12 mb-4 opacity-10" />
                        <div className="text-sm">Drag a visit here or select from dropdown</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ViewPane;

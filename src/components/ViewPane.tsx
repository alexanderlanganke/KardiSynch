import React, { useState } from 'react';
import { ErrorBoundary } from '../renderer/components/ErrorBoundary';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import ReportViewer from './ReportViewer';
import FormattedReport from '@/renderer/components/FormattedReport';
import SummaryReport from '@/renderer/components/SummaryReport';
import { FileText, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-react';
import { Button } from './ui/button';
import { cn, formatDate } from '@/lib/utils';

// Pinned pseudo-report id for the Summary entry at the top of the visit
// selector — not a real visit, so it's never present in `availableReports`.
export const SUMMARY_REPORT_ID = '__summary__';
export const SUMMARY_REPORT = { id: SUMMARY_REPORT_ID };

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
    const prevReportIdRef = React.useRef<string | null>(null);
    // Monotonic token so a slow getVisitFiles response for a previous visit
    // can't overwrite the files of the visit that was selected afterwards
    // (rapid drag-drops onto the same pane race otherwise).
    const loadRequestRef = React.useRef(0);
    React.useEffect(() => {
        const loadFiles = async () => {
            if (selectedReport && selectedReport.id !== SUMMARY_REPORT_ID && selectedReport.directoryName) {
                const requestId = ++loadRequestRef.current;
                const reportChanged = prevReportIdRef.current !== selectedReport.id;
                prevReportIdRef.current = selectedReport.id;
                try {
                    const files = await window.electronAPI.getVisitFiles(patientId, selectedReport.directoryName);
                    if (requestId !== loadRequestRef.current) return; // stale response — a newer visit was selected
                    const safeFiles = Array.isArray(files) ? files : [];
                    setAvailableFiles(safeFiles);

                    const pdfs = safeFiles.filter((f: string) => !f.toLowerCase().endsWith('.xml'));
                    // When the pane switches to a different visit (e.g. a new visit
                    // is dropped onto an already-occupied pane), always pick that
                    // visit's best file. Previously this was gated on `!selectedFile`,
                    // so the stale file from the prior visit kept being displayed and
                    // the dragged visit did not show up (issue #141). Preserve the
                    // user's manual dropdown choice only while the same visit stays
                    // selected.
                    if (reportChanged) {
                        setSelectedFile(pdfs.length > 0 ? getBestFile(pdfs) : null);
                    } else if (pdfs.length > 0 && !selectedFile) {
                        setSelectedFile(getBestFile(pdfs));
                    }
                } catch (error) {
                    if (requestId !== loadRequestRef.current) return;
                    console.error('Failed to load visit files:', error);
                    setAvailableFiles([]);
                }
            } else {
                loadRequestRef.current++; // invalidate any in-flight load
                prevReportIdRef.current = null;
                setAvailableFiles([]);
                setSelectedFile(null);
            }
        };
        loadFiles();
    }, [selectedReport, patientId]);

    // Only show non-XML files to the user; XMLs are used in background (formatted view)
    const displayFiles = availableFiles.filter((f: string) => !f.toLowerCase().endsWith('.xml'));

    const getBestFile = (files: string[]) => {
        const pdfFile = files.find((f: string) => f.toLowerCase().endsWith('.pdf'));
        return pdfFile || files[0] || null;
    };

    const effectiveSelectedFile = selectedFile || (displayFiles.length > 0 ? getBestFile(displayFiles) : null);

    React.useEffect(() => {
        if (displayFiles.length > 0 && !selectedFile) {
            setSelectedFile(getBestFile(displayFiles));
        } else if (!selectedReport) {
            setSelectedFile(null);
            setIsControlsExpanded(true);
        }
    }, [displayFiles, selectedFile, selectedReport]);

    React.useEffect(() => {
        if (effectiveSelectedFile) {
            setIsControlsExpanded(false);
        }
    }, [effectiveSelectedFile]);

    // Auto-switch to formatted view when selected file is binary (non-renderable)
    React.useEffect(() => {
        if (effectiveSelectedFile && getFileType(effectiveSelectedFile) === 'binary' && viewMode === 'raw') {
            setViewMode('formatted');
        }
    }, [effectiveSelectedFile]);

    // Keyboard Navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isActive || !displayFiles.length) return;

            // Don't hijack arrow keys while the user is typing in a form control
            // or interacting with an open dialog above this pane.
            const target = e.target as HTMLElement | null;
            if (target && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
                return;
            }

            if (e.key === 'ArrowLeft') {
                cycleFile('prev');
            } else if (e.key === 'ArrowRight') {
                cycleFile('next');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, displayFiles, effectiveSelectedFile]);

    const cycleFile = (direction: 'next' | 'prev') => {
        if (!displayFiles.length || !effectiveSelectedFile) return;

        const currentIndex = displayFiles.indexOf(effectiveSelectedFile);
        if (currentIndex === -1) return;

        let newIndex;
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % displayFiles.length;
        } else {
            newIndex = (currentIndex - 1 + displayFiles.length) % displayFiles.length;
        }

        setSelectedFile(displayFiles[newIndex]);
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

    const getFileType = (filePath: string): 'xml' | 'pdf' | 'image' | 'binary' => {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.xml')) return 'xml';
        if (lower.endsWith('.pdf')) return 'pdf';
        if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
        if (lower.match(/\.(pdd|pkg|bnk)$/)) return 'binary';
        return 'xml';
    };

    // Check if all available files are non-renderable binary formats
    const hasOnlyBinaryFiles = displayFiles.length > 0 && displayFiles.every(
        (f: string) => f.toLowerCase().match(/\.(pdd|pkg|bnk)$/)
    );

    const isSummary = selectedReport?.id === SUMMARY_REPORT_ID;

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
                "flex flex-col h-full min-h-0 border-r border-border last:border-r-0 transition-all duration-200",
                isDragOver && 'bg-muted',
                isActive && 'ring-2 ring-inset ring-primary'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={onActivate}
        >
            {/* Header with file selector */}
            <div className="border-b border-border bg-card flex flex-col transition-all duration-300 ease-in-out">
                {/* Collapsed Summary Bar */}
                {!isControlsExpanded && selectedReport && (
                    <div
                        className="flex items-center justify-between p-2 cursor-pointer hover:bg-accent group"
                        onClick={() => setIsControlsExpanded(true)}
                    >
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1 min-w-0">
                            {isSummary ? (
                                <>
                                    <LayoutDashboard className="h-3 w-3 flex-shrink-0" />
                                    <span className="font-medium text-foreground whitespace-nowrap">Summary</span>
                                </>
                            ) : (
                                <>
                                    <FileText className="h-3 w-3 flex-shrink-0" />
                                    <span className="font-medium text-foreground whitespace-nowrap">
                                        {formatDate(selectedReport.interrogation_date)}
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
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {/* View Mode Toggle */}
                            {!isSummary && (
                            <div className="flex items-center bg-muted rounded-md p-0.5 mr-1">
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
                            )}

                            {!isSummary && displayFiles.length > 1 && viewMode === 'raw' && (
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
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Expand pane controls">
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
                                    } else if (value === SUMMARY_REPORT_ID) {
                                        onReportSelect(paneId, SUMMARY_REPORT);
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
                                    <SelectItem value={SUMMARY_REPORT_ID}>
                                        <span className="flex items-center gap-1.5">
                                            <LayoutDashboard className="h-3 w-3" /> Summary
                                        </span>
                                    </SelectItem>
                                    {availableReports.map((report) => (
                                        <SelectItem key={report.id} value={report.id}>
                                            {formatDate(report.interrogation_date)} - {report.manufacturer}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* View Mode Toggle */}
                            {selectedReport && selectedReport.id !== SUMMARY_REPORT_ID && (
                                <div className="flex items-center bg-muted rounded-md p-0.5">
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
                                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleClear} title="Clear Selection" aria-label="Clear selection">
                                        <X className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setIsControlsExpanded(false)} title="Collapse Controls" aria-label="Collapse pane controls">
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>

                        {/* File Selector (only in raw mode) */}
                        {selectedReport && displayFiles.length > 0 && viewMode === 'raw' && (
                            <div className="flex items-center gap-2 pl-6">
                                <span className="text-xs text-muted-foreground">File:</span>
                                <Select value={effectiveSelectedFile || ''} onValueChange={setSelectedFile}>
                                    <SelectTrigger className="h-7 text-xs flex-1">
                                        <SelectValue placeholder="Select file" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {displayFiles.map((file: string, idx: number) => {
                                            const fileName = file.split(/[/\\]/).pop();
                                            return (
                                                <SelectItem key={idx} value={file}>{fileName}</SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                {displayFiles.length > 1 && (
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
                    isSummary ? (
                        <SummaryReport availableReports={availableReports} />
                    ) : viewMode === 'formatted' || (effectiveSelectedFile && getFileType(effectiveSelectedFile) === 'binary') ? (
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

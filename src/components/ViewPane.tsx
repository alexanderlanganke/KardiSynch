import React, { useState } from 'react';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import ReportViewer from './ReportViewer';
import { FileText, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';

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

    // Fetch files when selected report changes
    React.useEffect(() => {
        const loadFiles = async () => {
            if (selectedReport && selectedReport.directoryName) {
                try {
                    const files = await window.electronAPI.getVisitFiles(patientId, selectedReport.directoryName);
                    setAvailableFiles(files);

                    // Auto-select best file
                    if (files.length > 0 && !selectedFile) {
                        setSelectedFile(getBestFile(files));
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

    // Calculate effective selected file for render to avoid empty value in Select
    const getBestFile = (files: string[]) => {
        const xmlFile = files.find((f: string) => f.toLowerCase().endsWith('.xml'));
        const pdfFile = files.find((f: string) => f.toLowerCase().endsWith('.pdf'));
        return xmlFile || pdfFile || files[0];
    };

    const effectiveSelectedFile = selectedFile || (availableFiles.length > 0 ? getBestFile(availableFiles) : null);

    // Update state if needed (for consistency)
    React.useEffect(() => {
        if (availableFiles.length > 0 && !selectedFile) {
            setSelectedFile(getBestFile(availableFiles));
        } else if (!selectedReport) {
            setSelectedFile(null);
            setIsControlsExpanded(true); // Expand when cleared
        }
    }, [availableFiles, selectedFile, selectedReport]);

    // Auto-collapse when a file is effectively selected and loaded
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
    };

    const getFileType = (filePath: string): 'xml' | 'pdf' | 'image' => {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.xml')) return 'xml';
        if (lower.endsWith('.pdf')) return 'pdf';
        if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
        return 'xml'; // Default fallback
    };

    return (
        <div
            className={`flex flex-col h-full border-r border-border last:border-r-0 transition-all duration-200 ${isDragOver ? 'bg-primary/5' : ''
                } ${isActive ? 'ring-2 ring-inset ring-primary/20' : ''}`}
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
                            <span>•</span>
                            <span className="whitespace-nowrap">{selectedReport.manufacturer}</span>
                            {effectiveSelectedFile && (
                                <>
                                    <span>•</span>
                                    <span className="truncate max-w-[150px]">
                                        {effectiveSelectedFile.split(/[/\\]/).pop()}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {availableFiles.length > 1 && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => { e.stopPropagation(); cycleFile('prev'); }}
                                        title="Previous Document (Left Arrow)"
                                    >
                                        <ChevronLeft className="h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => { e.stopPropagation(); cycleFile('next'); }}
                                        title="Next Document (Right Arrow)"
                                    >
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
                            {selectedReport && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 flex-shrink-0"
                                        onClick={handleClear}
                                        title="Clear Selection"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 flex-shrink-0"
                                        onClick={() => setIsControlsExpanded(false)}
                                        title="Collapse Controls"
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>

                        {/* File Selector (only if report selected and has files) */}
                        {selectedReport && availableFiles.length > 0 && (
                            <div className="flex items-center gap-2 pl-6">
                                <span className="text-xs text-muted-foreground">File:</span>
                                <Select
                                    value={effectiveSelectedFile || ''}
                                    onValueChange={setSelectedFile}
                                >
                                    <SelectTrigger className="h-7 text-xs flex-1">
                                        <SelectValue placeholder="Select file" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableFiles.map((file: string, idx: number) => {
                                            const fileName = file.split(/[/\\]/).pop();
                                            return (
                                                <SelectItem key={idx} value={file}>
                                                    {fileName}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                {availableFiles.length > 1 && (
                                    <div className="flex items-center gap-0.5">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => cycleFile('prev')}
                                            title="Previous Document"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => cycleFile('next')}
                                            title="Next Document"
                                        >
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
                    <ReportViewer
                        report={selectedReport}
                        type={effectiveSelectedFile ? getFileType(effectiveSelectedFile) : 'xml'}
                        filePath={effectiveSelectedFile || undefined}
                    />
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

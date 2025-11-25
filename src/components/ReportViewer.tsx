import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Activity, Battery, Zap, Heart } from 'lucide-react';
import { Button } from './ui/button';

interface ReportViewerProps {
    report: any;
    type: 'xml' | 'pdf' | 'image';
    filePath?: string;
}

const ReportViewer: React.FC<ReportViewerProps> = ({ report, type, filePath }) => {
    const [xmlData, setXmlData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (type === 'xml' && filePath) {
            const loadXml = async () => {
                setLoading(true);
                try {
                    const data = await window.electronAPI.getParsedXml(filePath);
                    setXmlData(data);
                } catch (error) {
                    console.error('Failed to load XML data:', error);
                } finally {
                    setLoading(false);
                }
            };
            loadXml();
        } else {
            setXmlData(null);
        }
    }, [type, filePath]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading data...
            </div>
        );
    }

    if (type === 'xml') {
        // Use fetched data if available (from file), otherwise use passed report object
        const dataToDisplay = xmlData || report;
        if (dataToDisplay) {
            return <BiotronikDataViewer data={dataToDisplay} />;
        }
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

// PDF Viewer
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Search, X } from 'lucide-react';

// Configure PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const PDFViewer: React.FC<{ filePath: string }> = ({ filePath }) => {
    const [numPages, setNumPages] = React.useState<number | null>(null);
    const [pageNumber, setPageNumber] = React.useState(1);
    const [scale, setScale] = React.useState(1.0);
    const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [isSearchVisible, setIsSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');

    React.useEffect(() => {
        let url: string | null = null;
        const loadPdf = async () => {
            if (!filePath) return;
            setLoading(true);
            setError(null);
            try {
                console.log('[ReportViewer] Requesting PDF data for:', filePath);
                const data = await window.electronAPI.getPdfData(filePath);
                console.log('[ReportViewer] Received data. Type:', data?.constructor.name, 'Size:', data?.byteLength);

                // Create a Blob URL from the data
                // This avoids ArrayBuffer detachment issues because we pass a URL string to react-pdf
                const blob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
                url = URL.createObjectURL(blob);
                setPdfUrl(url);
            } catch (err) {
                console.error('Failed to load PDF data:', err);
                setError('Failed to load PDF file.');
            } finally {
                setLoading(false);
            }
        };

        loadPdf();
        setPageNumber(1);
        setScale(1.0);

        // Cleanup Blob URL on unmount or file change
        return () => {
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [filePath]);

    function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
        console.log('[ReportViewer] Document loaded successfully. Pages:', numPages);
        setNumPages(numPages);
        setPageNumber(1);
    }

    function onDocumentLoadError(error: Error) {
        console.error('[ReportViewer] Document load error:', error);
        setError(`Render Error: ${error.message}`);
    }



    const changePage = (offset: number) => {
        setPageNumber(prevPageNumber => prevPageNumber + offset);
    };

    const previousPage = () => changePage(-1);
    const nextPage = () => changePage(1);

    const zoomIn = () => setScale(prev => Math.min(prev + 0.1, 2.0));
    const zoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery) {
            window.electronAPI.findInPage(searchQuery, { forward: true, findNext: false });
        }
    };

    const findNext = () => {
        if (searchQuery) {
            window.electronAPI.findInPage(searchQuery, { forward: true, findNext: true });
        }
    };

    const findPrev = () => {
        if (searchQuery) {
            window.electronAPI.findInPage(searchQuery, { forward: false, findNext: true });
        }
    };

    const closeSearch = () => {
        window.electronAPI.stopFindInPage('clearSelection');
        setIsSearchVisible(false);
        setSearchQuery('');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading PDF...
            </div>
        );
    }

    if (error || !pdfUrl) {
        return (
            <div className="flex items-center justify-center h-full text-destructive">
                {error || 'No PDF data available.'}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full min-w-0">
            {/* Controls */}
            <div className="flex-shrink-0 w-full flex items-center justify-between px-2 py-1 border-b border-border bg-card/50">
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber <= 1}
                        onClick={previousPage}
                        title="Previous Page"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-1">
                        {pageNumber}/{numPages || '--'}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber >= (numPages || 0)}
                        onClick={nextPage}
                        title="Next Page"
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Search Toggle */}
                <div className="flex items-center gap-1">
                    {isSearchVisible ? (
                        <form onSubmit={handleSearch} className="flex items-center gap-1 bg-background border border-input rounded-md px-2 h-7">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="bg-transparent border-none outline-none text-xs w-28"
                                autoFocus
                            />
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={findPrev}>
                                <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <Button type="submit" variant="ghost" size="icon" className="h-5 w-5" onClick={findNext}>
                                <ChevronRight className="h-3 w-3" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={closeSearch}>
                                <X className="h-3 w-3" />
                            </Button>
                        </form>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setIsSearchVisible(true)}
                            title="Search Text"
                        >
                            <Search className="h-3.5 w-3.5" />
                        </Button>
                    )}

                    <div className="w-px h-4 bg-border mx-0.5" />

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={zoomOut}
                        disabled={scale <= 0.5}
                        title="Zoom Out"
                    >
                        <ZoomOut className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground w-10 text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={zoomIn}
                        disabled={scale >= 2.0}
                        title="Zoom In"
                    >
                        <ZoomIn className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            {/* PDF Document */}
            <div className="flex-1 overflow-auto p-4 flex justify-center bg-muted/10 min-w-0">
                <Document
                    file={pdfUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    className="shadow-lg"
                    loading={
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            Rendering PDF...
                        </div>
                    }
                    error={
                        <div className="flex items-center justify-center h-full text-destructive">
                            {error || 'Failed to render PDF.'}
                        </div>
                    }
                >
                    <Page
                        pageNumber={pageNumber}
                        scale={scale}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        className="bg-white"
                    />
                </Document>
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

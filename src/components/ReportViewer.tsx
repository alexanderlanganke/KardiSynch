import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Activity, Battery, Zap, Heart } from 'lucide-react';
import { Button } from './ui/button';

interface ReportViewerProps {
    report: any;
    type: 'xml' | 'pdf' | 'image' | 'text';
    filePath?: string;
}

const ReportViewer: React.FC<ReportViewerProps> = ({ report, type, filePath }) => {
    const [xmlBlobUrl, setXmlBlobUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [textContent, setTextContent] = React.useState<string | null>(null);

    React.useEffect(() => {
        // Cleanup function to revoke Blob URLs
        return () => {
            if (xmlBlobUrl) URL.revokeObjectURL(xmlBlobUrl);
        };
    }, [xmlBlobUrl]);

    React.useEffect(() => {
        if (type === 'xml' && filePath) {
            const loadXml = async () => {
                setLoading(true);
                try {
                    // Fetch as text to display nicely in browser's native XML viewer
                    const text = await window.electronAPI.readFileText(filePath);
                    const blob = new Blob([text], { type: 'text/xml' });
                    const url = URL.createObjectURL(blob);
                    setXmlBlobUrl(url);
                } catch (error) {
                    console.error('Failed to load XML data:', error);
                } finally {
                    setLoading(false);
                }
            };
            loadXml();
        } else if (type === 'text' && filePath) {
            const loadText = async () => {
                setLoading(true);
                try {
                    const text = await window.electronAPI.readFileText(filePath);
                    setTextContent(text);
                } catch (error) {
                    console.error('Failed to load text data:', error);
                } finally {
                    setLoading(false);
                }
            };
            loadText();
        } else {
            setXmlBlobUrl(null);
            setTextContent(null);
        }
    }, [type, filePath]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading data...
            </div>
        );
    }

    if (type === 'xml' && xmlBlobUrl) {
        return (
            <div className="w-full h-full bg-white">
                <iframe
                    src={xmlBlobUrl}
                    className="w-full h-full border-none"
                    title="XML Preview"
                />
            </div>
        );
    }

    if (type === 'pdf' && filePath) {
        return <PDFViewer filePath={filePath} />;
    }

    if (type === 'image' && filePath) {
        return <ImageViewer filePath={filePath} />;
    }

    if (type === 'text' && textContent) {
        return (
            <div className="w-full h-full p-6 bg-white overflow-auto font-mono text-xs whitespace-pre-wrap">
                {textContent}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
            No data available
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

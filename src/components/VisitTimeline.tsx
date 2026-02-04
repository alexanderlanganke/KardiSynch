import React from 'react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Calendar, FileText, RefreshCw, FolderInput, Download } from 'lucide-react';

interface Visit {
    id: string;
    interrogation_date: string;
    manufacturer: string;
    fileCount?: number;
}

interface VisitTimelineProps {
    visits: Visit[];
    onVisitSelect: (visit: Visit) => void;
    onRescan: (visit: Visit) => void;
    onMove: (visit: Visit) => void;
    onExport: (visit: Visit) => void;
}

const VisitTimeline: React.FC<VisitTimelineProps> = ({ visits, onVisitSelect, onRescan, onMove, onExport }) => {
    const handleDragStart = (e: React.DragEvent, visit: Visit) => {
        e.dataTransfer.setData('visitId', visit.id);
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div className="border-t border-border bg-card/50">
            <div className="px-4 py-2">
                <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <h3 className="font-semibold text-xs">Visit Timeline</h3>
                    <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                        {visits.length} visits
                    </Badge>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {visits.length === 0 ? (
                        <div className="text-muted-foreground text-xs py-4 text-center w-full">
                            No visits found
                        </div>
                    ) : (
                        visits.map((visit) => (
                            <Card
                                key={visit.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, visit)}
                                onClick={() => onVisitSelect(visit)}
                                className="glass-card min-w-[150px] cursor-pointer hover:border-primary/50 transition-all hover:shadow-sm p-3 group relative"
                            >
                                {/* Hover Actions Overlay */}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm rounded-md border p-0.5 shadow-sm">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:text-primary"
                                        title="Rescan & Update Data"
                                        onClick={(e) => { e.stopPropagation(); onRescan(visit); }}
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:text-blue-500"
                                        title="Move to another Patient"
                                        onClick={(e) => { e.stopPropagation(); onMove(visit); }}
                                    >
                                        <FolderInput className="h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:text-green-500"
                                        title="Export Visit Files"
                                        onClick={(e) => { e.stopPropagation(); onExport(visit); }}
                                    >
                                        <Download className="h-3 w-3" />
                                    </Button>
                                </div>

                                <div className="space-y-2 pt-1">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-semibold">
                                            {new Date(visit.interrogation_date).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="text-[10px] text-muted-foreground truncate max-w-[80px]" title={visit.manufacturer}>
                                            {visit.manufacturer || 'Unknown'}
                                        </div>
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-secondary/50">
                                            <FileText className="h-2 w-2 mr-1 opacity-70" />
                                            {visit.fileCount}
                                        </Badge>
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default VisitTimeline;

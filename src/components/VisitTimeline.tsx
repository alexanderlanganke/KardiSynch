import React from 'react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar, FileText } from 'lucide-react';

interface Visit {
    id: string;
    interrogation_date: string;
    manufacturer: string;
    fileCount?: number;
}

interface VisitTimelineProps {
    visits: Visit[];
    onVisitSelect: (visit: Visit) => void;
}

const VisitTimeline: React.FC<VisitTimelineProps> = ({ visits, onVisitSelect }) => {
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
                                className="glass-card min-w-[140px] cursor-move hover:border-primary/50 transition-all hover:shadow-sm p-2"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-medium">
                                            {new Date(visit.interrogation_date).toLocaleDateString()}
                                        </div>
                                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                                            <FileText className="h-2 w-2 mr-1" />
                                            {visit.fileCount}
                                        </Badge>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                        {visit.manufacturer || 'Unknown'}
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

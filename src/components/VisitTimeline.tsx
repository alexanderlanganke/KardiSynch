import React from 'react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar, FileText } from 'lucide-react';

interface Visit {
    id: string;
    interrogation_date: string;
    manufacturer: string;
    fileCount: number;
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
            <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">Visit Timeline</h3>
                    <Badge variant="outline" className="ml-auto">
                        {visits.length} visits
                    </Badge>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2">
                    {visits.length === 0 ? (
                        <div className="text-muted-foreground text-sm py-8 text-center w-full">
                            No visits found for this patient
                        </div>
                    ) : (
                        visits.map((visit) => (
                            <Card
                                key={visit.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, visit)}
                                onClick={() => onVisitSelect(visit)}
                                className="glass-card min-w-[180px] cursor-move hover:border-primary/50 transition-all hover:shadow-md"
                            >
                                <div className="p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-medium">
                                            {new Date(visit.interrogation_date).toLocaleDateString()}
                                        </div>
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                            <FileText className="h-3 w-3 mr-1" />
                                            {visit.fileCount}
                                        </Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
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

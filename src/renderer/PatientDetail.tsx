import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppContext, ViewerSlot } from './AppContext';
import ViewerArea from './ViewerArea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

const PatientDetail: React.FC = () => {
  const { currentPatientId, viewerSlots, setViewerSlots } = useAppContext();
  const [reports, setReports] = useState<any[]>([]);

  useEffect(() => {
    if (currentPatientId) {
      fetchReports(currentPatientId);
    }
  }, [currentPatientId]);

  const fetchReports = async (id: string) => {
    try {
      const fetchedReports = await window.electronAPI.getPatientReports(id);
      setReports(fetchedReports);
    } catch (error) {
      console.error('Error fetching patient reports:', error);
    }
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const overIsViewerSlot = over.id.toString().startsWith('slot-');
      const activeIsTimelineItem = !active.id.toString().startsWith('slot-');

      if (overIsViewerSlot && activeIsTimelineItem) {
        const slotIndex = parseInt(over.id.toString().replace('slot-', ''), 10);
        const report = reports.find((r) => r.id === active.id);
        if (report) {
          const newSlots = [...viewerSlots];
          newSlots[slotIndex] = { report, viewMode: 'pdf' };
          setViewerSlots(newSlots);
        }
      }
    }
  };

  const handleClose = (slotIndex: number) => {
    const newSlots = [...viewerSlots];
    newSlots[slotIndex] = null;
    setViewerSlots(newSlots);
  };

  const handleViewModeChange = (
    slotIndex: number,
    viewMode: 'pdf' | 'data'
  ) => {
    const newSlots = [...viewerSlots];
    if (newSlots[slotIndex]) {
      (newSlots[slotIndex] as ViewerSlot).viewMode = viewMode;
      setViewerSlots(newSlots);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full p-4">
        <div className="flex-1 flex gap-4">
          {viewerSlots.map((slot, i) => (
            <Droppable key={`slot-${i}`} id={`slot-${i}`}>
              <Card className="h-full">
                <CardContent className="h-full p-2">
                  {slot ? (
                    <ViewerArea
                      slot={slot}
                      onClose={() => handleClose(i)}
                      onViewModeChange={(vm) => handleViewModeChange(i, vm)}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <p>Drop a report here</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Droppable>
          ))}
        </div>
        <Card className="h-48 p-4">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-24 whitespace-nowrap">
              <SortableContext items={reports.map((r) => r.id)}>
                <div className="flex space-x-4">
                  {reports.map((report) => (
                    <Draggable key={report.id} id={report.id}>
                      <Card className="p-2 cursor-grab w-20 h-20 flex items-center justify-center">
                        <p
                          className="font-semibold transform -rotate-90"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {report.visit_date}
                        </p>
                      </Card>
                    </Draggable>
                  ))}
                </div>
              </SortableContext>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </DndContext>
  );
};

const Draggable: React.FC<{ id: any; children: React.ReactNode }> = ({
  id,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

const Droppable: React.FC<{ id: any; children: React.ReactNode }> = ({
  id,
  children,
}) => {
  const { setNodeRef } = useSortable({ id });
  return (
    <div ref={setNodeRef} className="h-full">
      {children}
    </div>
  );
};

export default PatientDetail;

import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppContext, ViewerSlot } from './AppContext';
import ViewerArea from './ViewerArea';

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
        const report = reports.find(r => r.id === active.id);
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

  const handleViewModeChange = (slotIndex: number, viewMode: 'pdf' | 'data') => {
    const newSlots = [...viewerSlots];
    if (newSlots[slotIndex]) {
      (newSlots[slotIndex] as ViewerSlot).viewMode = viewMode;
      setViewerSlots(newSlots);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <main>
        <div className="viewer-container">
          {viewerSlots.map((slot, i) => (
            <Droppable key={`slot-${i}`} id={`slot-${i}`}>
              {slot ? (
                <ViewerArea slot={slot} onClose={() => handleClose(i)} onViewModeChange={(vm) => handleViewModeChange(i, vm)} />
              ) : (
                <div className="placeholder">Drop a report here</div>
              )}
            </Droppable>
          ))}
        </div>

        <div className="timeline-container">
          <SortableContext items={reports.map(r => r.id)}>
            {reports.map(report => (
              <Draggable key={report.id} id={report.id}>
                <div className="timeline-item">
                  <p>{report.visit_date}</p>
                </div>
              </Draggable>
            ))}
          </SortableContext>
        </div>
      </main>
    </DndContext>
  );
};

const Draggable: React.FC<{ id: any, children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
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

const Droppable: React.FC<{ id: any, children: React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef } = useSortable({ id });
  return (
    <div ref={setNodeRef} className="viewer-slot">
      {children}
    </div>
  );
};


export default PatientDetail;

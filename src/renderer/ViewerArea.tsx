import React from 'react';
import ReportViewer from '@/components/ReportViewer';
import { ViewerSlot } from './AppContext';

interface ViewerAreaProps {
  slot: ViewerSlot;
  onClose: () => void;
  onViewModeChange: (viewMode: 'pdf' | 'data') => void;
}

const ViewerArea: React.FC<ViewerAreaProps> = ({ slot, onClose, onViewModeChange }) => {
  return (
    <div className="viewer-area">
      <div className="controls">
        <button onClick={() => onViewModeChange('pdf')} className={slot.viewMode === 'pdf' ? 'active' : ''}>PDF</button>
        <button onClick={() => onViewModeChange('data')} className={slot.viewMode === 'data' ? 'active' : ''}>Data</button>
        <button className="close-btn" onClick={onClose}>X</button>
      </div>

      <div className="content">
        <ReportViewer
          report={slot.report}
          type={slot.viewMode === 'pdf' ? 'pdf' : 'xml'}
          filePath={slot.report.pdf_path} // Pass PDF path. For 'data' mode, ReportViewer uses 'report' prop or fetches if filePath provided.
        />
      </div>
    </div>
  );
};

export default ViewerArea;

import React from 'react';
import PdfViewer from './PdfViewer';
import UnifiedDataViewer from './UnifiedDataViewer';
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
        {slot.viewMode === 'pdf' ? (
          <PdfViewer pdfPath={slot.report.pdf_path} />
        ) : (
          <UnifiedDataViewer reportData={slot.report} />
        )}
      </div>
    </div>
  );
};

export default ViewerArea;

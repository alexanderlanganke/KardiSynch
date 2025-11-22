import React from 'react';

interface UnifiedDataViewerProps {
  reportData: any;
}

const UnifiedDataViewer: React.FC<UnifiedDataViewerProps> = ({ reportData }) => {
  return (
    <div className="data-viewer">
      {reportData ? (
        <>
          <h2>Unified Report Data</h2>
          <pre>{JSON.stringify(reportData, null, 2)}</pre>
        </>
      ) : (
        <p>No data available.</p>
      )}
    </div>
  );
};

export default UnifiedDataViewer;

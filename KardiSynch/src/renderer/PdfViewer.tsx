import React, { useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

interface PdfViewerProps {
  pdfPath: string;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ pdfPath }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

    const renderPdf = async () => {
      if (pdfPath && canvasRef.current) {
        try {
          const pdfData = await window.electronAPI.getPdfData(pdfPath);
          const loadingTask = pdfjsLib.getDocument({ data: pdfData });
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });

          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            const renderContext = {
              canvasContext: context,
              viewport: viewport
            };
            page.render(renderContext);
          }
        } catch (error) {
          console.error('Error rendering PDF:', error);
        }
      }
    };

    renderPdf();
  }, [pdfPath]);

  return <canvas ref={canvasRef}></canvas>;
};

export default PdfViewer;

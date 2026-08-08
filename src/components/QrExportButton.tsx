import React, { useState } from 'react';
import { QrCode, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import QrCodeView from './QrCodeView';
import { cn } from '@/lib/utils';

interface QrExportButtonProps {
  patient: any;
  // Provide either a report already in hand, or an async loader (e.g. the
  // dashboard doesn't preload per-visit clinical data, so it fetches on click).
  report?: any;
  loadReport?: () => Promise<any | null>;
  title?: string;
  className?: string;
}

const QrExportButton: React.FC<QrExportButtonProps> = ({ patient, report, loadReport, title, className }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedReport, setLoadedReport] = useState<any | null>(null);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (report) {
      setOpen(true);
      return;
    }
    if (!loadReport) return;
    setLoading(true);
    try {
      const r = await loadReport();
      setLoadedReport(r);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const activeReport = report || loadedReport;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
        onClick={handleClick}
        disabled={loading}
        title={title || 'Export QR code for CardioPal'}
        aria-label={title || 'Export QR code for CardioPal'}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>QR Export</DialogTitle>
          </DialogHeader>
          <QrCodeView report={activeReport} patient={patient} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default QrExportButton;

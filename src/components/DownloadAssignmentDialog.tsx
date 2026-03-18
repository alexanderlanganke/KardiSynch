import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Archive, FileText, Wifi } from 'lucide-react';

interface DownloadInfo {
  filePath: string;
  filename: string;
  sourceDomain: string;
  sourceManufacturer: string;
}

interface DownloadAssignmentDialogProps {
  open: boolean;
  downloadInfo: DownloadInfo | null;
  onAssign: () => void;
  onDismiss: () => void;
}

const DownloadAssignmentDialog: React.FC<DownloadAssignmentDialogProps> = ({
  open,
  downloadInfo,
  onAssign,
  onDismiss,
}) => {
  if (!downloadInfo) return null;

  // Friendly domain label
  const domainLabels: Record<string, string> = {
    'carelink.medtronic.com': 'CareLink',
    'europe.medtroniccarelink.net': 'CareLink',
    'biotronik-homemonitoring.com': 'Home Monitoring',
    'www.merlin.net': 'Merlin.net',
    'merlin.net': 'Merlin.net',
    'latitude.bostonscientific.com': 'LATITUDE',
    'www.latitude.bostonscientific.com': 'LATITUDE',
  };

  const friendlySource = domainLabels[downloadInfo.sourceDomain] || downloadInfo.sourceDomain;
  const isZip = downloadInfo.filename.toLowerCase().endsWith('.zip');
  const FileIcon = isZip ? Archive : FileText;
  const fileTypeLabel = isZip ? 'A report archive' : 'A PDF';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-blue-400" />
            Remote Monitoring Download
          </DialogTitle>
          <DialogDescription>
            {fileTypeLabel} was downloaded from {friendlySource}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
            <FileIcon className="h-8 w-8 text-blue-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{downloadInfo.filename}</p>
              <p className="text-xs text-muted-foreground">
                {downloadInfo.sourceManufacturer} &middot; {downloadInfo.sourceDomain}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onDismiss}>
            No, save to Downloads
          </Button>
          <Button onClick={onAssign}>
            Yes, assign to patient
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DownloadAssignmentDialog;

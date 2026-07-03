import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderInput, RefreshCw, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAppDialog } from '@/renderer/components/AppDialogProvider';
import type { OrphanVisit } from '@/renderer/electron';

interface OrphanVisitsModalProps {
  open: boolean;
  onClose: () => void;
}

const OrphanVisitsModal: React.FC<OrphanVisitsModalProps> = ({ open, onClose }) => {
  const { showAlert } = useAppDialog();
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [orphans, setOrphans] = useState<OrphanVisit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const found = await window.electronAPI.findOrphanedVisits();
      setOrphans(found);
      setSelected(new Set(found.map(o => o.reportId))); // default: fix all
    } catch (e) {
      await showAlert('Failed to scan for misplaced visits.');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    if (open) {
      setOrphans([]);
      setSelected(new Set());
      scan();
    }
  }, [open, scan]);

  const toggle = (reportId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId); else next.add(reportId);
      return next;
    });
  };

  const move = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setMoving(true);
    try {
      const res = await window.electronAPI.moveOrphanedVisits(ids);
      let msg = `Moved ${res.moved} visit${res.moved === 1 ? '' : 's'} to the correct patient.`;
      if (res.errors.length) msg += `\n\nWarnings:\n${res.errors.join('\n')}`;
      await showAlert(msg);
      await scan();
    } catch (e) {
      await showAlert('Failed to move visits.');
    } finally {
      setMoving(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !moving && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5 text-primary" />
            Repair Misplaced Visits
          </DialogTitle>
          <DialogDescription>
            Finds visits stored under the wrong patient folder — where the database says the visit belongs to a
            different patient than the folder it sits in — and moves them to the correct patient.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end mb-2">
          <Button variant="ghost" size="sm" onClick={scan} disabled={loading || moving}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Rescan
          </Button>
        </div>

        <ScrollArea className="h-[50vh] pr-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Scanning for misplaced visits…
            </div>
          ) : orphans.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">No misplaced visits found. Everything is in the right folder.</div>
          ) : (
            <div className="space-y-2">
              {orphans.map(o => {
                const isSelected = selected.has(o.reportId);
                return (
                  <label
                    key={o.reportId}
                    className={`flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer ${isSelected ? 'border-primary bg-primary/5' : 'border-border'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={moving}
                      onChange={() => toggle(o.reportId)}
                      className="h-4 w-4 mt-0.5 rounded text-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium flex flex-wrap items-center gap-x-2">
                        Visit {o.date ? formatDate(o.date) : '(unknown date)'}
                        <span className="text-xs text-muted-foreground">· {o.fileCount} file{o.fileCount === 1 ? '' : 's'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-muted-foreground border-border">
                          {o.currentPatientLabel || o.currentPatientDirName || 'Unknown folder'}
                        </Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <Badge variant="outline" className="text-primary border-primary/40">
                          {o.correctPatientLabel || o.correctPatientId}
                        </Badge>
                        {!o.correctPatientDirExists && (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> folder will be created
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-muted-foreground truncate">
                        {o.currentPatientDirName}/{o.visitDirName}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={moving}>Close</Button>
          <Button onClick={move} disabled={moving || loading || selectedCount === 0}>
            {moving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderInput className="mr-2 h-4 w-4" />}
            Move {selectedCount > 0 ? `${selectedCount} ` : ''}to correct patient
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OrphanVisitsModal;

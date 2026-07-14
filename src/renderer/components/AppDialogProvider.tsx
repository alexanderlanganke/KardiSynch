import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AppDialogContext {
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
}

const AppDialogCtx = createContext<AppDialogContext | undefined>(undefined);

export const useAppDialog = () => {
  const ctx = useContext(AppDialogCtx);
  if (!ctx) throw new Error('useAppDialog must be used within AppDialogProvider');
  return ctx;
};

interface DialogState {
  open: boolean;
  type: 'alert' | 'confirm';
  title: string;
  message: string;
}

interface QueuedDialog {
  type: 'alert' | 'confirm';
  title: string;
  message: string;
  resolve: (value: boolean) => void;
}

export const AppDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DialogState>({ open: false, type: 'alert', title: '', message: '' });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  // Dialogs requested while one is already open wait here. Overwriting the
  // pending resolver instead would leave the first awaiting caller hanging
  // forever.
  const queueRef = useRef<QueuedDialog[]>([]);

  const present = (dialog: QueuedDialog) => {
    if (resolveRef.current) {
      queueRef.current.push(dialog);
      return;
    }
    resolveRef.current = dialog.resolve;
    setState({ open: true, type: dialog.type, title: dialog.title, message: dialog.message });
  };

  const showAlert = useCallback((message: string, title?: string): Promise<void> => {
    return new Promise((resolve) => {
      present({ type: 'alert', title: title || '', message, resolve: () => resolve() });
    });
  }, []);

  const showConfirm = useCallback((message: string, title?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      present({ type: 'confirm', title: title || 'Confirm', message, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    const resolve = resolveRef.current;
    const next = queueRef.current.shift();
    if (next) {
      resolveRef.current = next.resolve;
      setState({ open: true, type: next.type, title: next.title, message: next.message });
    } else {
      resolveRef.current = null;
      setState(prev => ({ ...prev, open: false }));
    }
    resolve?.(result);
  };

  return (
    <AppDialogCtx.Provider value={{ showAlert, showConfirm }}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleClose(false); }}>
        <DialogContent className="bg-card border border-border shadow-xl sm:max-w-md">
          <DialogHeader>
            {state.title && <DialogTitle>{state.title}</DialogTitle>}
            <DialogDescription className="text-sm text-foreground whitespace-pre-wrap">
              {state.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {state.type === 'confirm' ? (
              <>
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={() => handleClose(true)}>OK</Button>
              </>
            ) : (
              <Button onClick={() => handleClose(true)}>OK</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppDialogCtx.Provider>
  );
};

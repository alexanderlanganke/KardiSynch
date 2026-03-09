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

export const AppDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DialogState>({ open: false, type: 'alert', title: '', message: '' });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const showAlert = useCallback((message: string, title?: string): Promise<void> => {
    return new Promise((resolve) => {
      resolveRef.current = () => resolve();
      setState({ open: true, type: 'alert', title: title || '', message });
    });
  }, []);

  const showConfirm = useCallback((message: string, title?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, type: 'confirm', title: title || 'Confirm', message });
    });
  }, []);

  const handleClose = (result: boolean) => {
    setState(prev => ({ ...prev, open: false }));
    resolveRef.current?.(result);
    resolveRef.current = null;
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

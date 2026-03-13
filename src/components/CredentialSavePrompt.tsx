import React from 'react';
import { Button } from './ui/button';
import { KeyRound, X } from 'lucide-react';

interface CredentialSavePromptProps {
  domain: string;
  username: string;
  onSave: () => void;
  onDismiss: () => void;
}

const CredentialSavePrompt: React.FC<CredentialSavePromptProps> = ({
  domain,
  username,
  onSave,
  onDismiss,
}) => {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-background p-3 shadow-lg max-w-sm animate-in slide-in-from-top-2">
      <KeyRound className="h-5 w-5 text-blue-400 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Save password?</p>
        <p className="text-xs text-muted-foreground truncate">
          {username} on {domain}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button size="sm" variant="default" onClick={onSave}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default CredentialSavePrompt;

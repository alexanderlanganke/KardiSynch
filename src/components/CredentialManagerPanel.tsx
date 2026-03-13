import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Trash2, ShieldAlert, Key } from 'lucide-react';

interface Credential {
  domain: string;
  username: string;
  updated_at: string;
}

const CredentialManagerPanel: React.FC = () => {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const isAvail = await window.electronAPI.credentialIsAvailable();
      setAvailable(isAvail);
      if (isAvail) {
        const list = await window.electronAPI.credentialList();
        setCredentials(list);
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (domain: string, username: string) => {
    await window.electronAPI.credentialDelete(domain, username);
    load();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!available) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm">
        <ShieldAlert className="h-4 w-4 text-yellow-500 flex-shrink-0" />
        <p>OS keychain is not available. Credential storage is disabled. On Linux, install and configure <code>gnome-keyring</code> or <code>kwallet</code>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Saved Credentials</h4>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {credentials.length}
        </Badge>
      </div>

      {credentials.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved credentials.</p>
      ) : (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <div
              key={`${cred.domain}:${cred.username}`}
              className="flex items-center justify-between p-2 rounded-md border border-border"
            >
              <div>
                <p className="text-sm font-medium">{cred.domain}</p>
                <p className="text-xs text-muted-foreground">{cred.username}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => handleDelete(cred.domain, cred.username)}
                title="Delete credential"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CredentialManagerPanel;

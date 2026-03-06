import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderOpen, Save, RotateCcw, RefreshCw, Archive, Download, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

// Logos
import biotronikLogo from './assets/logos/biotronik.svg';
import medtronicLogo from './assets/logos/medtronic.svg';
import abbottLogo from './assets/logos/abbott.svg';
import bostonLogo from './assets/logos/boston_scientific.svg';
import impulseLogo from './assets/logos/impulse_dynamics.svg';
import microportLogo from './assets/logos/microport.svg';

const LOGO_MAP: Record<string, string> = {
  'Biotronik': biotronikLogo,
  'Medtronic': medtronicLogo,
  'Abbott': abbottLogo,
  'Boston Scientific': bostonLogo,
  'Impulse Dynamics': impulseLogo,
  'MicroPort': microportLogo
};

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<{
    importDir: string;
    unmatchedDir: string;
    dataPath: string;
    usbSourceDirectories: string[];
    usbTargetDirectory: string;
    updateChannel: string;
    mriCountry: string;
    mriManufacturers: Record<string, boolean>;
  }>({
    importDir: '',
    unmatchedDir: '',
    dataPath: '',
    usbSourceDirectories: [],
    usbTargetDirectory: '',
    updateChannel: 'stable',
    mriCountry: 'Germany',
    mriManufacturers: {} as Record<string, boolean>,
  });
  const [updateStatus, setUpdateStatus] = useState<string>('Idle');
  const [appVersion, setAppVersion] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const fetchedSettings = await window.electronAPI.getSettings();
        if (fetchedSettings) {
          setSettings({ ...settings, ...fetchedSettings });
        }
        const version = await window.electronAPI.getAppVersion();
        setAppVersion(version);
      } catch (error) {
        console.error('Error fetching settings or version:', error);
      }
    };
    fetchSettings();

    const cleanup = window.electronAPI.onUpdateStatus((status: any) => {
      if (typeof status === 'string') setUpdateStatus(status);
      else if (status.message) setUpdateStatus(status.message);
      else setUpdateStatus(JSON.stringify(status));
    });

    return () => { cleanup(); };
  }, []);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await window.electronAPI.setSettings(settings);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings({ ...settings, [e.target.name]: e.target.value });
  };

  const handleDirectorySelection = async (fieldName: keyof typeof settings) => {
    try {
      const directoryPath = await window.electronAPI.selectDirectory();
      if (directoryPath) {
        setSettings({ ...settings, [fieldName]: directoryPath });
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
    }
  };

  const handleReset = async () => {
    if (confirm('Are you sure you want to reset all settings to default? This action cannot be undone.')) {
      setLoading(true);
      try {
        const newSettings = await window.electronAPI.resetSettings();
        setSettings(newSettings);
        alert('Settings have been reset to defaults.');
      } catch (error) {
        console.error('Error resetting settings:', error);
        alert('Failed to reset settings.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-4xl h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage application preferences and storage paths.</p>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>

        <form onSubmit={saveSettings}>
          {/* General: Paths + Display */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Directory Configuration</CardTitle>
                <CardDescription>Configure where the application looks for files and stores data.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <DirectoryInput
                  id="import-dir" name="importDir" label="Import Directory"
                  description="The folder where you drop new PDF reports."
                  value={settings.importDir} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('importDir')}
                />
                <DirectoryInput
                  id="unmatched-dir" name="unmatchedDir" label="Unmatched Directory"
                  description="Files that cannot be processed will be moved here."
                  value={settings.unmatchedDir} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('unmatchedDir')}
                />
                <DirectoryInput
                  id="data-path" name="dataPath" label="Data Storage Path"
                  description="Where processed patient data and reports are stored."
                  value={settings.dataPath} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('dataPath')}
                />

                {/* USB Watcher (merged from separate tab) */}
                <div className="pt-4 border-t">
                  <h3 className="text-sm font-semibold mb-4">USB Watcher</h3>
                  <div className="space-y-4">
                    <DirectoryInput
                      id="usb-target-dir" name="usbTargetDirectory" label="Export Target Directory"
                      description="Files found in source directories will be moved here."
                      value={settings.usbTargetDirectory || ''} onChange={handleInputChange}
                      onBrowse={() => handleDirectorySelection('usbTargetDirectory')}
                    />
                    <div className="space-y-2">
                      <Label>Source Directories</Label>
                      <div className="space-y-2">
                        {settings.usbSourceDirectories && settings.usbSourceDirectories.map((dir, index) => (
                          <div key={index} className="flex gap-2 items-center">
                            <Input value={dir} readOnly className="bg-muted" />
                            <Button type="button" variant="destructive" size="icon" onClick={() => {
                              const newDirs = settings.usbSourceDirectories.filter((_, i) => i !== index);
                              setSettings({ ...settings, usbSourceDirectories: newDirs });
                            }}>
                              <span className="text-xs">X</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                      <Button type="button" variant="outline" onClick={async () => {
                        try {
                          const directoryPath = await window.electronAPI.selectDirectory();
                          if (directoryPath && !settings.usbSourceDirectories?.includes(directoryPath)) {
                            setSettings({ ...settings, usbSourceDirectories: [...(settings.usbSourceDirectories || []), directoryPath] });
                          }
                        } catch (error) {
                          console.error('Error selecting directory:', error);
                        }
                      }}>
                        <FolderOpen className="mr-2 h-4 w-4" /> Add Source Directory
                      </Button>
                      <p className="text-xs text-muted-foreground">Directories to watch for new files.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Automation: MRI + Scraper */}
          <TabsContent value="automation">
            <Card>
              <CardHeader>
                <CardTitle>MRI & Safety Check Configuration</CardTitle>
                <CardDescription>Configure settings for automated MRI and manufacturer warning checks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="mri-country">Country / Region</Label>
                  <Input id="mri-country" name="mriCountry" value={settings.mriCountry} onChange={handleInputChange} placeholder="e.g. United States, Germany" />
                  <p className="text-xs text-muted-foreground">The country to select on manufacturer websites. Defaults to 'Germany'.</p>
                </div>

                <div className="space-y-2 border p-4 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-orange-800 dark:text-orange-200">Retrigger All Checks</Label>
                      <p className="text-xs text-muted-foreground">Force re-check MRI status for ALL patients. Runs in background.</p>
                    </div>
                    <Button type="button" variant="secondary"
                      className="bg-orange-100 hover:bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:hover:bg-orange-900/60 dark:text-orange-100 border-orange-200"
                      onClick={async () => {
                        if (confirm("This will queue checks for EVERY patient. This may take significant time. Continue?")) {
                          try {
                            await window.electronAPI.retriggerAllMriChecks();
                            alert("All checks have been queued. Watch the notification center for progress.");
                          } catch (e) {
                            alert("Failed to trigger checks.");
                          }
                        }
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" /> Retrigger All
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <Label>Manufacturer Automation</Label>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(LOGO_MAP).map(([name, logo]) => {
                      const enabled = settings.mriManufacturers?.[name] ?? false;
                      const isUnavailable = name !== 'Biotronik' && name !== 'Medtronic' && name !== 'Boston Scientific' && name !== 'Abbott' && name !== 'St. Jude Medical' && name !== 'SJM';
                      const isMedtronic = name === 'Medtronic';

                      const handleToggle = (valOrEvent: boolean | any) => {
                        let newValue: boolean | undefined;
                        if (typeof valOrEvent === 'boolean') newValue = valOrEvent;
                        else if (valOrEvent && typeof valOrEvent.stopPropagation === 'function') valOrEvent.stopPropagation();

                        setSettings(prev => {
                          const currentMap = prev.mriManufacturers || {};
                          const currentVal = currentMap[name] ?? false;
                          const finalVal = newValue !== undefined ? newValue : !currentVal;
                          const newSettings = { ...prev, mriManufacturers: { ...currentMap, [name]: finalVal } };
                          window.electronAPI.setSettings(newSettings).catch(err => console.error('Failed to auto-save settings:', err));
                          return newSettings;
                        });
                      };

                      return (
                        <div
                          key={name}
                          className={`relative border rounded-lg p-4 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all
                            ${enabled ? 'border-primary ring-1 ring-primary bg-muted' : 'bg-muted opacity-70 hover:opacity-100'}`}
                          onClick={handleToggle}
                        >
                          <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                            <Switch checked={enabled} onCheckedChange={handleToggle} />
                          </div>
                          <img src={logo} alt={name} className="h-8 max-w-[120px] object-contain my-2" />
                          {isUnavailable && enabled && (
                            <span className="text-[10px] text-destructive font-bold bg-destructive/10 px-2 py-0.5 rounded-full">COMING SOON</span>
                          )}
                          {!enabled && <span className="text-[10px] text-muted-foreground">Disabled</span>}
                          {isMedtronic && enabled && (
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 mt-1" onClick={async (e) => {
                              e.stopPropagation();
                              const btn = e.currentTarget;
                              btn.innerText = 'Checking...';
                              btn.disabled = true;
                              try {
                                const res = await window.electronAPI.checkMedtronicUpdates();
                                if (res.updated) alert(`Medtronic Data Updated! ${res.count} items.`);
                                else if (res.error) alert(`Update Failed: ${res.error}`);
                                else alert(`Up to date. (${res.count} items)`);
                              } catch { alert('Error checking updates'); }
                              finally { btn.innerText = 'Check Updates'; btn.disabled = false; }
                            }}>Check Updates</Button>
                          )}
                          {name === 'Boston Scientific' && enabled && (
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 mt-1" onClick={async (e) => {
                              e.stopPropagation();
                              const btn = e.currentTarget;
                              btn.innerText = 'Checking...';
                              btn.disabled = true;
                              try {
                                const res = await window.electronAPI.checkBostonUpdates();
                                if (res.updated) alert(`Boston Data Updated! ${res.count} items.`);
                                else if (res.error) alert(`Update Failed: ${res.error}`);
                                else alert(`Up to date. (${res.count} items)`);
                              } catch { alert('Error checking updates'); }
                              finally { btn.innerText = 'Check Updates'; btn.disabled = false; }
                            }}>Check Updates</Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Enable automatic MRI checks for these manufacturers.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Database */}
          <TabsContent value="database">
            <Card>
              <CardHeader>
                <CardTitle>Database Maintenance</CardTitle>
                <CardDescription>Manage the database index and application data.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Rebuild Database</Label>
                    <p className="text-xs text-muted-foreground">Re-scan all patient files and rebuild the database index.</p>
                  </div>
                  <Button type="button" variant="secondary" onClick={async () => {
                    if (confirm('This will rescan all files and rebuild the database. Continue?')) {
                      setLoading(true);
                      try {
                        const result = await window.electronAPI.rebuildDatabase();
                        alert(`Database rebuild complete.\nProcessed ${result.patients} patients and ${result.reports} reports.`);
                      } catch (error) {
                        alert('Failed to rebuild database.');
                      } finally {
                        setLoading(false);
                      }
                    }
                  }} disabled={loading}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Rebuild Index
                  </Button>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-destructive">Reset Application Data</Label>
                      <p className="text-xs text-muted-foreground">Clear all local data and reset to defaults. This cannot be undone.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="destructive" type="button" onClick={async () => {
                        if (confirm('ARE YOU SURE? This will permanently DELETE ALL PATIENTS AND REPORTS.')) {
                          setLoading(true);
                          try {
                            await window.electronAPI.clearAllData();
                            alert('All data has been deleted.');
                            window.location.reload();
                          } catch (error) {
                            alert('Failed to delete data.');
                          } finally {
                            setLoading(false);
                          }
                        }
                      }} disabled={loading}>Delete All Data</Button>
                      <Button variant="outline" type="button" onClick={handleReset} disabled={loading}>Reset Settings</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* About */}
          <TabsContent value="about">
            <Card>
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  About KardiSynch
                  <span className="text-sm font-normal text-muted-foreground">v{appVersion}</span>
                </CardTitle>
                <CardDescription>Software updates and version information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 border rounded-lg bg-muted">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Update Status</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{updateStatus}</p>
                  </div>
                  <Button type="button" variant="default" onClick={() => window.electronAPI.checkForUpdates()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Check for Updates
                  </Button>
                </div>

                <div className="space-y-4">
                  <Label>Update Channel</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div
                      className={`cursor-pointer border rounded-lg p-4 flex items-start gap-3 hover:bg-accent transition-colors ${settings.updateChannel === 'stable' ? 'ring-2 ring-primary bg-muted' : ''}`}
                      onClick={() => setSettings({ ...settings, updateChannel: 'stable' })}
                    >
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-full">
                        <Archive className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                      </div>
                      <div>
                        <h4 className="font-medium">Stable Releases</h4>
                        <p className="text-xs text-muted-foreground mt-1">Official, tested releases. Recommended for production use.</p>
                      </div>
                    </div>
                    <div
                      className={`cursor-pointer border rounded-lg p-4 flex items-start gap-3 hover:bg-accent transition-colors ${settings.updateChannel === 'beta' ? 'ring-2 ring-primary bg-muted' : ''}`}
                      onClick={() => setSettings({ ...settings, updateChannel: 'beta' })}
                    >
                      <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-full">
                        <Download className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                      </div>
                      <div>
                        <h4 className="font-medium">Beta / Pre-releases</h4>
                        <p className="text-xs text-muted-foreground mt-1">Get the latest features early. May contain bugs.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {updateStatus.toLowerCase().includes('downloaded') && (
                  <div className="pt-4 border-t">
                    <Button type="button" className="w-full" variant="default" onClick={() => window.electronAPI.quitAndInstall()}>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Restart and Install Update
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <div className="mt-6 flex justify-end gap-4">
            <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reload
            </Button>
            <Button type="submit" disabled={loading}>
              <Save className="mr-2 h-4 w-4" /> {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Tabs>
    </div>
  );
};

// Reusable directory input component
const DirectoryInput: React.FC<{
  id: string; name: string; label: string; description: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBrowse: () => void;
}> = ({ id, name, label, description, value, onChange, onBrowse }) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex gap-2">
      <Input id={id} name={name} value={value} onChange={onChange} placeholder={`Select ${label.toLowerCase()}...`} />
      <Button type="button" variant="outline" size="icon" onClick={onBrowse} aria-label={`Browse for ${label}`}>
        <FolderOpen className="h-4 w-4" />
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{description}</p>
  </div>
);

export default Settings;

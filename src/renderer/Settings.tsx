import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderOpen, Save, RotateCcw, RefreshCw, Archive, Download, ShieldCheck, ArrowDown, ArrowRight, Check, HelpCircle, Bug, Copy, CircleCheck, CircleX } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useAppDialog } from './components/AppDialogProvider';
import CredentialManagerPanel from '@/components/CredentialManagerPanel';

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

const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

const Settings: React.FC = () => {
  const { showAlert, showConfirm } = useAppDialog();
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

  // Debug analyzer state (Biotronik)
  const [debugFilePath, setDebugFilePath] = useState('');
  const [debugResult, setDebugResult] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  // Debug analyzer state (Abbott)
  const [abbottFilePath, setAbbottFilePath] = useState('');
  const [abbottResult, setAbbottResult] = useState<any>(null);
  const [abbottLoading, setAbbottLoading] = useState(false);

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
      showAlert('Failed to save settings.');
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
    if (await showConfirm('Are you sure you want to reset all settings to default? This action cannot be undone.')) {
      setLoading(true);
      try {
        const newSettings = await window.electronAPI.resetSettings();
        setSettings(newSettings);
        await showAlert('Settings have been reset to defaults.');
      } catch (error) {
        console.error('Error resetting settings:', error);
        await showAlert('Failed to reset settings.');
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
          <TabsTrigger value="webpanel">Web Panel</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
          {DEBUG_MODE && <TabsTrigger value="debug"><Bug className="h-3.5 w-3.5 mr-1.5" />Debug</TabsTrigger>}
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
                <FileFlowDiagram />
                <DirectoryInput
                  id="import-dir" name="importDir" label="Import Directory"
                  description="New report files go here. The app watches this folder and automatically parses incoming files."
                  value={settings.importDir} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('importDir')}
                />
                <DirectoryInput
                  id="unmatched-dir" name="unmatchedDir" label="Unmatched Directory"
                  description="Files that fail parsing or can't be matched to a patient are moved here for manual review."
                  value={settings.unmatchedDir} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('unmatchedDir')}
                />
                <DirectoryInput
                  id="data-path" name="dataPath" label="Data Storage Path"
                  description="Successfully matched reports are stored here, organized by patient and visit."
                  value={settings.dataPath} onChange={handleInputChange}
                  onBrowse={() => handleDirectorySelection('dataPath')}
                />

                {/* USB Watcher (merged from separate tab) */}
                <div className="pt-4 border-t">
                  <h3 className="text-sm font-semibold mb-4">USB Watcher</h3>
                  <div className="space-y-4">
                    <DirectoryInput
                      id="usb-target-dir" name="usbTargetDirectory" label="Export Target Directory"
                      description="Files found on USB source directories are copied here before being processed by the Import Directory."
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
                      <p className="text-xs text-muted-foreground">Directories on USB drives to watch. Files found here are copied to the Export Target Directory.</p>
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
                <CardTitle>Safety Check Configuration</CardTitle>
                <CardDescription>Configure settings for manufacturer warning and advisory checks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="mri-country">Country / Region</Label>
                  <Input id="mri-country" name="mriCountry" value={settings.mriCountry} onChange={handleInputChange} placeholder="e.g. United States, Germany" />
                  <p className="text-xs text-muted-foreground">The country to select on manufacturer websites. Defaults to 'Germany'.</p>
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
                                if (res.updated) await showAlert(`Medtronic Data Updated! ${res.count} items.`);
                                else if (res.error) await showAlert(`Update Failed: ${res.error}`);
                                else await showAlert(`Up to date. (${res.count} items)`);
                              } catch { await showAlert('Error checking updates'); }
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
                                if (res.updated) await showAlert(`Boston Data Updated! ${res.count} items.`);
                                else if (res.error) await showAlert(`Update Failed: ${res.error}`);
                                else await showAlert(`Up to date. (${res.count} items)`);
                              } catch { await showAlert('Error checking updates'); }
                              finally { btn.innerText = 'Check Updates'; btn.disabled = false; }
                            }}>Check Updates</Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Enable automatic warning/advisory checks for these manufacturers. MRI compatibility must be verified directly on manufacturer websites.</p>
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
                    if (await showConfirm('This will rescan all files and rebuild the database. Continue?')) {
                      setLoading(true);
                      try {
                        const result = await window.electronAPI.rebuildDatabase();
                        await showAlert(`Database rebuild complete.\nProcessed ${result.patients} patients and ${result.reports} reports.`);
                      } catch (error) {
                        await showAlert('Failed to rebuild database.');
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
                      <Label>Deduplicate Reports</Label>
                      <p className="text-xs text-muted-foreground">Find and merge duplicate visit entries (same patient, same date). Keeps the most complete report.</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={async () => {
                      if (await showConfirm('This will find duplicate reports and merge them, keeping the most complete version. Continue?')) {
                        setLoading(true);
                        try {
                          const result = await window.electronAPI.dedupReports();
                          if (result.groupsFound === 0) {
                            await showAlert('No duplicate reports found.');
                          } else {
                            await showAlert(`Deduplication complete.\nFound ${result.groupsFound} duplicate groups.\nRemoved ${result.reportsRemoved} duplicate reports.\nCleaned up ${result.directoriesRemoved} directories.`);
                          }
                        } catch (error) {
                          await showAlert('Failed to deduplicate reports.');
                        } finally {
                          setLoading(false);
                        }
                      }
                    }} disabled={loading}>
                      <Copy className="mr-2 h-4 w-4" /> Deduplicate
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-destructive">Reset Application Data</Label>
                      <p className="text-xs text-muted-foreground">Clear all local data and reset to defaults. This cannot be undone.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="destructive" type="button" onClick={async () => {
                        if (await showConfirm('ARE YOU SURE? This will permanently DELETE ALL PATIENTS AND REPORTS.')) {
                          setLoading(true);
                          try {
                            await window.electronAPI.clearAllData();
                            await showAlert('All data has been deleted.');
                            window.location.reload();
                          } catch (error) {
                            await showAlert('Failed to delete data.');
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

          {/* Web Panel */}
          <TabsContent value="webpanel">
            <Card>
              <CardHeader>
                <CardTitle>Web Panel Settings</CardTitle>
                <CardDescription>Manage saved credentials for the integrated web browser. Passwords are encrypted using your OS keychain.</CardDescription>
              </CardHeader>
              <CardContent>
                <CredentialManagerPanel />
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

          {DEBUG_MODE && (
            <TabsContent value="debug">
              <Card>
                <CardHeader>
                  <CardTitle>Parser Structure Analyzer</CardTitle>
                  <CardDescription>
                    Load an XML file to inspect its internal structure without extracting patient data.
                    Results are safe to share — only tag names and attribute names are shown, never values.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Biotronik XML Analyzer</Label>
                    <div className="flex gap-2 items-center">
                      <Input value={debugFilePath} readOnly placeholder="No file selected..." className="bg-muted" />
                      <Button type="button" variant="outline" onClick={async () => {
                        const filePath = await window.electronAPI.selectFile([
                          { name: 'XML Files', extensions: ['xml'] }
                        ]);
                        if (filePath) { setDebugFilePath(filePath); setDebugResult(null); }
                      }}>
                        <FolderOpen className="mr-2 h-4 w-4" /> Select XML
                      </Button>
                      <Button type="button" onClick={async () => {
                        if (!debugFilePath) return;
                        setDebugLoading(true);
                        try {
                          const result = await window.electronAPI.analyzeBiotronikXml(debugFilePath);
                          setDebugResult(result);
                        } catch (error) {
                          console.error('Analysis failed:', error);
                          showAlert('Failed to analyze file. Make sure it is a valid XML file.');
                        } finally { setDebugLoading(false); }
                      }} disabled={!debugFilePath || debugLoading}>
                        {debugLoading ? 'Analyzing...' : 'Analyze'}
                      </Button>
                    </div>
                  </div>

                  {debugResult && (
                    <div className="space-y-4">
                      {/* Parser Lookup Summary */}
                      <div className="rounded-lg border p-4 space-y-3">
                        <h3 className="text-sm font-semibold">Parser Lookup Results</h3>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <LookupIndicator label="Summary Table" found={debugResult.parserLookups.summaryTable.found}
                            detail={debugResult.parserLookups.summaryTable.found
                              ? `via "${debugResult.parserLookups.summaryTable.foundVia}" in table "${debugResult.parserLookups.summaryTable.inTable}"`
                              : 'MANUFACTURERDESCR / CATAGGREGATDESCR not found in any table'} />
                          <LookupIndicator label="Settings Table" found={debugResult.parserLookups.settingsTable.found}
                            detail={debugResult.parserLookups.settingsTable.found
                              ? `via "${debugResult.parserLookups.settingsTable.foundVia}" in table "${debugResult.parserLookups.settingsTable.inTable}"`
                              : 'Elektrodenmodell / LeadModel / Kanäle / Channels not found'} />
                          <LookupIndicator label="Stats Table (9473)" found={debugResult.parserLookups.statsTable.found} />
                          <LookupIndicator label="Episode Table" found={debugResult.parserLookups.episodeTable.found} />
                          <LookupIndicator label="Personal Data" found={debugResult.parserLookups.personalData.found}
                            detail={debugResult.parserLookups.personalData.found
                              ? `Keys: ${debugResult.parserLookups.personalData.availableKeys.join(', ')}`
                              : undefined} />
                        </div>
                      </div>

                      {/* Section Hierarchy */}
                      <div className="rounded-lg border p-4 space-y-2">
                        <h3 className="text-sm font-semibold">Section Hierarchy</h3>
                        <div className="text-xs space-y-1">
                          {Object.entries(debugResult.sectionHierarchy).map(([section, keys]: [string, any]) => (
                            <div key={section}>
                              <span className="font-medium text-muted-foreground">{section}:</span>{' '}
                              <span>{keys.join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tables */}
                      <div className="rounded-lg border p-4 space-y-3">
                        <h3 className="text-sm font-semibold">Tables ({debugResult.tables.length})</h3>
                        {debugResult.tables.map((table: any, idx: number) => (
                          <div key={idx} className="border rounded p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">{table.tableName}</span>
                              <span className="text-muted-foreground">{table.source} &middot; {table.entryCount} entries</span>
                            </div>
                            <div><span className="text-muted-foreground">Attributes:</span> {table.attributeNames.join(', ') || '(none)'}</div>
                            <div><span className="text-muted-foreground">Value types:</span> {table.valueTypes.join(', ') || '(none)'}</div>
                            {table.hasForeignKeys && (
                              <div><span className="text-muted-foreground">ForeignKeys:</span> {table.foreignKeyCount} &middot; Attributes: {table.foreignKeyAttributeNames.join(', ')}</div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Raw JSON (copyable) */}
                      <div className="relative">
                        <Button type="button" size="sm" variant="outline" className="absolute top-2 right-2"
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(debugResult, null, 2))}>
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                        <pre className="rounded-lg border bg-muted p-4 text-[11px] overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                          {JSON.stringify(debugResult, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Abbott Log Analyzer */}
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Abbott Log Analyzer</CardTitle>
                  <CardDescription>
                    Load an Abbott .log file to inspect which parser patterns match.
                    Results are safe to share — only field labels and match status are shown, never patient values.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Abbott Log File</Label>
                    <div className="flex gap-2 items-center">
                      <Input value={abbottFilePath} readOnly placeholder="No file selected..." className="bg-muted" />
                      <Button type="button" variant="outline" onClick={async () => {
                        const filePath = await window.electronAPI.selectFile([
                          { name: 'Log Files', extensions: ['log'] }
                        ]);
                        if (filePath) { setAbbottFilePath(filePath); setAbbottResult(null); }
                      }}>
                        <FolderOpen className="mr-2 h-4 w-4" /> Select Log
                      </Button>
                      <Button type="button" onClick={async () => {
                        if (!abbottFilePath) return;
                        setAbbottLoading(true);
                        try {
                          const result = await window.electronAPI.analyzeAbbottLog(abbottFilePath);
                          setAbbottResult(result);
                        } catch (error) {
                          console.error('Abbott analysis failed:', error);
                          showAlert('Failed to analyze file. Make sure it is a valid Abbott .log file.');
                        } finally { setAbbottLoading(false); }
                      }} disabled={!abbottFilePath || abbottLoading}>
                        {abbottLoading ? 'Analyzing...' : 'Analyze'}
                      </Button>
                    </div>
                  </div>

                  {abbottResult && (
                    <div className="space-y-4">
                      {/* Format & Stats */}
                      <div className="rounded-lg border p-4 space-y-3">
                        <h3 className="text-sm font-semibold">File Overview</h3>
                        <div className="grid grid-cols-3 gap-4 text-xs">
                          <div className="p-2 rounded border bg-background">
                            <span className="text-muted-foreground">Format:</span>{' '}
                            <span className="font-medium">{abbottResult.format}</span>
                          </div>
                          <div className="p-2 rounded border bg-background">
                            <span className="text-muted-foreground">Lines:</span>{' '}
                            <span className="font-medium">{abbottResult.lineCount.toLocaleString()}</span>
                          </div>
                          <div className="p-2 rounded border bg-background">
                            <span className="text-muted-foreground">Labels found:</span>{' '}
                            <span className="font-medium">{abbottResult.stats.totalLabels}</span>
                          </div>
                        </div>
                        {abbottResult.docxStructure && (
                          <div className="grid grid-cols-3 gap-4 text-xs mt-2">
                            <div className="p-2 rounded border bg-background">
                              <span className="text-muted-foreground">DOCX tables:</span>{' '}
                              <span className="font-medium">{abbottResult.docxStructure.tableCount}</span>
                            </div>
                            <div className="p-2 rounded border bg-background">
                              <span className="text-muted-foreground">Text elements:</span>{' '}
                              <span className="font-medium">{abbottResult.docxStructure.textElementCount}</span>
                            </div>
                            <div className="p-2 rounded border bg-background">
                              <span className="text-muted-foreground">Paragraph styles:</span>{' '}
                              <span className="font-medium">{abbottResult.docxStructure.paragraphStyles.length}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Pattern Match Results */}
                      <div className="rounded-lg border p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Pattern Match Results</h3>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            abbottResult.stats.coveragePercent >= 75 ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                            abbottResult.stats.coveragePercent >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' :
                            'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                          }`}>
                            {abbottResult.stats.matchedByParser}/{Object.keys(abbottResult.parserPatternMatches).length} patterns matched ({abbottResult.stats.coveragePercent}% of labels)
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {Object.entries(abbottResult.parserPatternMatches).map(([key, matched]: [string, any]) => (
                            <LookupIndicator key={key} label={key} found={matched} />
                          ))}
                        </div>
                      </div>

                      {/* Uncaptured Fields */}
                      {abbottResult.uncapturedFields.length > 0 && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <h3 className="text-sm font-semibold">Uncaptured Fields ({abbottResult.uncapturedFields.length})</h3>
                          <p className="text-xs text-muted-foreground">Clinical data fields not captured by any parser pattern. These are missed opportunities for extraction.</p>
                          <div className="flex flex-wrap gap-1.5">
                            {abbottResult.uncapturedFields.map((field: any) => (
                              <span key={field.label} className="text-[11px] px-2 py-0.5 rounded-full border bg-muted font-mono">
                                {field.label} <span className="text-muted-foreground">{field.valueType}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section Headers */}
                      {abbottResult.sections.length > 0 && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <h3 className="text-sm font-semibold">Section Headers ({abbottResult.sections.length})</h3>
                          <div className="flex flex-wrap gap-1.5">
                            {abbottResult.sections.map((header: string) => (
                              <span key={header} className="text-[11px] px-2 py-0.5 rounded-full border bg-background font-mono">{header}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Labels Found */}
                      {abbottResult.labels.length > 0 && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <h3 className="text-sm font-semibold">Labels Found ({abbottResult.labels.length})</h3>
                          <div className="flex flex-wrap gap-1.5">
                            {abbottResult.labels.map((label: string) => (
                              <span key={label} className="text-[11px] px-2 py-0.5 rounded-full border bg-background font-mono">{label}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw JSON (copyable) */}
                      <div className="relative">
                        <Button type="button" size="sm" variant="outline" className="absolute top-2 right-2"
                          onClick={() => navigator.clipboard.writeText(JSON.stringify(abbottResult, null, 2))}>
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                        <pre className="rounded-lg border bg-muted p-4 text-[11px] overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                          {JSON.stringify(abbottResult, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

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

// Visual flow diagram showing how files move between directories
const FileFlowDiagram: React.FC = () => (
  <div className="rounded-lg border bg-muted/40 p-4 text-xs mb-2">
    <div className="flex flex-col items-center gap-1">
      {/* Row 1: USB Source → Import Directory */}
      <div className="flex items-center gap-3 w-full justify-center">
        <div className="rounded border bg-background px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
          USB Source Dirs
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className="text-[10px]">copy</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
        <div className="rounded border-2 border-primary bg-primary/10 px-3 py-1.5 font-semibold text-primary whitespace-nowrap">
          Import Directory
        </div>
        <span className="text-muted-foreground ml-1">&#8592; you drop files here</span>
      </div>

      {/* Arrow down */}
      <div className="flex items-center gap-1 text-muted-foreground py-0.5">
        <ArrowDown className="h-3.5 w-3.5" />
        <span className="text-[10px]">auto-parse</span>
      </div>

      {/* Row 2: Branch into matched / unmatched */}
      <div className="flex items-start justify-center gap-12">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" />
            <span className="text-[10px] font-medium">matched</span>
          </div>
          <ArrowDown className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <div className="rounded border-2 border-green-600 dark:border-green-400 bg-green-600/10 px-3 py-1.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
            Data Storage
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <HelpCircle className="h-3 w-3" />
            <span className="text-[10px] font-medium">unmatched</span>
          </div>
          <ArrowDown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <div className="rounded border-2 border-amber-600 dark:border-amber-400 bg-amber-600/10 px-3 py-1.5 font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
            Unmatched Directory
          </div>
        </div>
      </div>
    </div>
  </div>
);

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

// Debug lookup result indicator
const LookupIndicator: React.FC<{ label: string; found: boolean; detail?: string }> = ({ label, found, detail }) => (
  <div className="flex items-start gap-2 p-2 rounded border bg-background">
    {found
      ? <CircleCheck className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
      : <CircleX className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
    <div>
      <span className="font-medium">{label}</span>
      {detail && <p className="text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  </div>
);

export default Settings;

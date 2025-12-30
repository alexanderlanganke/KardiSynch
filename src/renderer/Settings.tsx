import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderOpen, Save, RotateCcw } from 'lucide-react';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<{
    importDir: string;
    unmatchedDir: string;
    dataPath: string;
    dbPath: string;
    usbSourceDirectories: string[];
    usbTargetDirectory: string;
  }>({
    importDir: '',
    unmatchedDir: '',
    dataPath: '',
    dbPath: '',
    usbSourceDirectories: [],
    usbTargetDirectory: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const fetchedSettings = await window.electronAPI.getSettings();
        if (fetchedSettings) {
          setSettings({ ...settings, ...fetchedSettings });
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };
    fetchSettings();
  }, []);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await window.electronAPI.setSettings(settings);
      // alert('Settings saved successfully!'); // Replaced with a more subtle indication or toast if available
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

      <Tabs defaultValue="paths" className="space-y-4">
        <TabsList>
          <TabsTrigger value="paths">File Paths</TabsTrigger>
          <TabsTrigger value="usb">USB Watcher</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <form onSubmit={saveSettings}>
          <TabsContent value="paths">
            <Card>
              <CardHeader>
                <CardTitle>Directory Configuration</CardTitle>
                <CardDescription>
                  Configure where the application looks for files and stores data.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="import-dir">Import Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="import-dir"
                      name="importDir"
                      value={settings.importDir}
                      onChange={handleInputChange}
                      placeholder="Select import directory..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleDirectorySelection('importDir')}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The folder where you drop new PDF reports.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unmatched-dir">Unmatched Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="unmatched-dir"
                      name="unmatchedDir"
                      value={settings.unmatchedDir}
                      onChange={handleInputChange}
                      placeholder="Select unmatched directory..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleDirectorySelection('unmatchedDir')}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Files that cannot be processed will be moved here.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="data-path">Data Storage Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="data-path"
                      name="dataPath"
                      value={settings.dataPath}
                      onChange={handleInputChange}
                      placeholder="Select data path..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleDirectorySelection('dataPath')}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Where processed patient data and reports are stored.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="database">
            <Card>
              <CardHeader>
                <CardTitle>Database Configuration</CardTitle>
                <CardDescription>
                  Manage the SQLite database connection.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="db-path">Database File Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="db-path"
                      name="dbPath"
                      value={settings.dbPath}
                      onChange={handleInputChange}
                      placeholder="Select database file..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleDirectorySelection('dbPath')}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Location of the SQLite database file. Changing this requires a restart.
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="text-sm font-medium mb-2">Maintenance</h3>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Rebuild Database</Label>
                      <p className="text-xs text-muted-foreground">
                        Re-scan all patient files and rebuild the database index. Use this if data is missing or out of sync.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        if (confirm('This will rescan all files and rebuild the database. This may take a while. Continue?')) {
                          setLoading(true);
                          try {
                            const result = await window.electronAPI.rebuildDatabase();
                            alert(`Database rebuild complete.\nProcessed ${result.patients} patients and ${result.reports} reports.`);
                          } catch (error) {
                            console.error('Rebuild failed:', error);
                            alert('Failed to rebuild database.');
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                      disabled={loading}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Rebuild Index
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>Use with caution.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Reset Application Data</Label>
                    <p className="text-xs text-muted-foreground">Clear all local data and reset to defaults.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      type="button"
                      onClick={async () => {
                        if (confirm('ARE YOU SURE? This will permanently DELETE ALL PATIENTS AND REPORTS. This action cannot be undone.')) {
                          setLoading(true);
                          try {
                            await window.electronAPI.clearAllData();
                            alert('All data has been deleted. The application has been reset.');
                            window.location.reload(); // Reload UI to clear state
                          } catch (error) {
                            console.error('Failed to clear data:', error);
                            alert('Failed to delete data. Check logs.');
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                      disabled={loading}
                    >
                      Delete All Data
                    </Button>
                    <Button variant="outline" type="button" onClick={handleReset} disabled={loading}>Reset Settings</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="mt-6 flex justify-end gap-4">
            <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload
            </Button>
            <Button type="submit" disabled={loading}>
              <Save className="mr-2 h-4 w-4" />
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
          <TabsContent value="usb">
            <Card>
              <CardHeader>
                <CardTitle>USB Watcher Configuration</CardTitle>
                <CardDescription>
                  Automatically move files from source drives (e.g., USB sticks) to a target directory and import them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                <div className="space-y-2">
                  <Label htmlFor="usb-target-dir">Target Directory (External App)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="usb-target-dir"
                      name="usbTargetDirectory"
                      value={settings.usbTargetDirectory || ''}
                      onChange={handleInputChange}
                      placeholder="Select target directory..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleDirectorySelection('usbTargetDirectory')}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Files found in source directories will be moved here.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Source Directories</Label>
                  <div className="space-y-2">
                    {settings.usbSourceDirectories && settings.usbSourceDirectories.map((dir, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <Input value={dir} readOnly className="bg-muted" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          onClick={() => {
                            const newDirs = settings.usbSourceDirectories.filter((_, i) => i !== index);
                            setSettings({ ...settings, usbSourceDirectories: newDirs });
                          }}
                        >
                          <span className="text-xs">X</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const directoryPath = await window.electronAPI.selectDirectory();
                        if (directoryPath && !settings.usbSourceDirectories?.includes(directoryPath)) {
                          setSettings({
                            ...settings,
                            usbSourceDirectories: [...(settings.usbSourceDirectories || []), directoryPath]
                          });
                        }
                      } catch (error) {
                        console.error('Error selecting directory:', error);
                      }
                    }}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Add Source Directory
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Directories to watch for new files (e.g., mapped network drives or USB paths).
                  </p>
                </div>

              </CardContent>
            </Card>
          </TabsContent>
        </form>
      </Tabs>
    </div >
  );
};

export default Settings;

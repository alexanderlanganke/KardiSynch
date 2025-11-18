import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/ui/ModeToggle';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState({
    importDir: '',
    unmatchedDir: '',
    dataPath: '',
    dbPath: '',
  });

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
    try {
      await window.electronAPI.setSettings(settings);
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings.');
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

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      <div className='flex items-center justify-between'>
        <p className="text-xl font-bold mb-6">Theme</p>
        <ModeToggle />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Settings</CardTitle>
        </CardHeader>
        <form onSubmit={saveSettings}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-dir">Import Directory:</Label>
              <div className="flex items-center">
                <Input
                  id="import-dir"
                  type="text"
                  name="importDir"
                  value={settings.importDir}
                  onChange={handleInputChange}
                />
                <Button onClick={() => handleDirectorySelection('importDir')} type="button" className="ml-2">Browse</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unmatched-dir">Unmatched Directory:</Label>
              <div className="flex items-center">
                <Input
                  id="unmatched-dir"
                  type="text"
                  name="unmatchedDir"
                  value={settings.unmatchedDir}
                  onChange={handleInputChange}
                />
                <Button onClick={() => handleDirectorySelection('unmatchedDir')} type="button" className="ml-2">Browse</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-path">Data Path:</Label>
              <div className="flex items-center">
                <Input
                  id="data-path"
                  type="text"
                  name="dataPath"
                  value={settings.dataPath}
                  onChange={handleInputChange}
                />
                <Button onClick={() => handleDirectorySelection('dataPath')} type="button" className="ml-2">Browse</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-path">Database Path:</Label>
              <div className="flex items-center">
                <Input
                  id="db-path"
                  type="text"
                  name="dbPath"
                  value={settings.dbPath}
                  onChange={handleInputChange}
                />
                <Button onClick={() => handleDirectorySelection('dbPath')} type="button" className="ml-2">Browse</Button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit">Save</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Settings;

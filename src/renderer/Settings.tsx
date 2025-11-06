import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/ui/ModeToggle';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState({
    someSetting: '',
    anotherSetting: '',
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
              <Label htmlFor="some-setting">Some Setting:</Label>
              <Input
                id="some-setting"
                type="text"
                name="someSetting"
                value={settings.someSetting}
                onChange={handleInputChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="another-setting">Another Setting:</Label>
              <Input
                id="another-setting"
                type="text"
                name="anotherSetting"
                value={settings.anotherSetting}
                onChange={handleInputChange}
              />
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

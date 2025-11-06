import React, { useState, useEffect } from 'react';

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
    <main>
      <h1>Settings</h1>

      <form onSubmit={saveSettings}>
        <div className="form-group">
          <label htmlFor="some-setting">Some Setting:</label>
          <input id="some-setting" type="text" name="someSetting" value={settings.someSetting} onChange={handleInputChange} />
        </div>

        <div className="form-group">
          <label htmlFor="another-setting">Another Setting:</label>
          <input id="another-setting" type="text" name="anotherSetting" value={settings.anotherSetting} onChange={handleInputChange} />
        </div>

        <button type="submit">Save</button>
      </form>
    </main>
  );
};

export default Settings;

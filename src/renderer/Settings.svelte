<script lang="ts">
  import { onMount } from 'svelte';

  let settings = {
    someSetting: '',
    anotherSetting: '',
  };

  onMount(async () => {
    try {
      const fetchedSettings = await window.electronAPI.getSettings();
      if (fetchedSettings) {
        settings = { ...settings, ...fetchedSettings };
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  });

  async function saveSettings() {
    try {
      await window.electronAPI.setSettings(settings);
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings.');
    }
  }
</script>

<main>
  <h1>Settings</h1>

  <form on:submit|preventDefault={saveSettings}>
    <div class="form-group">
      <label for="some-setting">Some Setting:</label>
      <input id="some-setting" type="text" bind:value={settings.someSetting} />
    </div>

    <div class="form-group">
      <label for="another-setting">Another Setting:</label>
      <input id="another-setting" type="text" bind:value={settings.anotherSetting} />
    </div>

    <button type="submit">Save</button>
  </form>
</main>

<style>
  main {
    padding: 1em;
  }
  .form-group {
    margin-bottom: 1em;
  }
  label {
    display: block;
    margin-bottom: 0.5em;
  }
  input {
    width: 100%;
    padding: 0.5em;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
</style>

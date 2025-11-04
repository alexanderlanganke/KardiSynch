<script lang="ts">
  import PatientDashboard from './PatientDashboard.svelte';
  import PatientDetail from './PatientDetail.svelte';
  import Settings from './Settings.svelte';
  import { currentView } from './stores';
  import UnmatchedFilesNotification from './UnmatchedFilesNotification.svelte';
</script>

<main>
  <UnmatchedFilesNotification />
  <nav>
    <button on:click={() => currentView.set('dashboard')}>Dashboard</button>
    <button on:click={() => currentView.set('settings')}>Settings</button>
  </nav>

  {#if $currentView === 'dashboard'}
    <PatientDashboard />
  {:else if $currentView === 'settings'}
    <Settings />
  {:else if $currentView === 'patientDetail'}
    <PatientDetail />
  {/if}
</main>

<style>
  nav {
    display: flex;
    gap: 1em;
    padding: 1em;
    border-bottom: 1px solid #ddd;
  }
</style>

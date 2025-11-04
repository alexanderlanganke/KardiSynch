<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPatientId } from './stores';

  let reports = [];
  let patientId = $currentPatientId;

  onMount(async () => {
    if (patientId) {
      await fetchReports(patientId);
    }
  });

  async function fetchReports(id) {
    try {
      reports = await window.electronAPI.getPatientReports(id);
    } catch (error) {
      console.error('Error fetching patient reports:', error);
    }
  }

  currentPatientId.subscribe(id => {
    if (id) {
      patientId = id;
      fetchReports(id);
    }
  });
</script>

<main>
  <h1>Patient Detail</h1>

  {#if reports.length > 0}
    <div class="timeline">
      {#each reports as report}
        <div class="timeline-item">
          <div class="timeline-content">
            <h2>{report.visit_date}</h2>
            <p><strong>Hospital Visit ID:</strong> {report.hospitalVisitId}</p>
            <p><strong>Device Manufacturer:</strong> {report.device_manufacturer}</p>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p>No reports found for this patient.</p>
  {/if}
</main>

<style>
  main {
    padding: 1em;
  }
  .timeline {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .timeline::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 20px;
    width: 4px;
    background: #ddd;
  }
  .timeline-item {
    position: relative;
    margin-bottom: 2em;
  }
  .timeline-content {
    position: relative;
    margin-left: 60px;
    background: #fff;
    padding: 1em;
    border-radius: 6px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  }
</style>

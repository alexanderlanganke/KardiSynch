<script lang="ts">
  import { onMount } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import { currentPatientId, viewerSlots, type ViewerSlot } from './stores';
  import ViewerArea from './ViewerArea.svelte';

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

  function handleDndConsider(e) {
    const { items, info } = e.detail;
    reports = items;
  }

  function handleDndFinalize(e) {
    const { items, info } = e.detail;
    if (info.trigger === 'droppedIntoZone') {
      const report = info.id;
      const slotIndex = info.zone.id;
      viewerSlots.update(slots => {
        slots[slotIndex] = { report: report, viewMode: 'pdf' };
        return slots;
      });
    }
    reports = items;
  }

  function handleClose(slotIndex: number) {
    viewerSlots.update(slots => {
      slots[slotIndex] = null;
      return slots;
    });
  }

  currentPatientId.subscribe(id => {
    if (id) {
      patientId = id;
      fetchReports(id);
    }
  });
</script>

<main>
  <div class="viewer-container">
    {#each $viewerSlots as slot, i}
      <div class="viewer-slot" use:dndzone={{ items: [], id: i }} on:consider={handleDndConsider} on:finalize={handleDndFinalize}>
        {#if slot}
          <ViewerArea bind:slot={slot} on:close={() => handleClose(i)} />
        {:else}
          <div class="placeholder">Drop a report here</div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="timeline-container">
    <div use:dndzone={{ items: reports }} on:consider={handleDndConsider} on:finalize={handleDndFinalize}>
      {#each reports as report (report.id)}
        <div class="timeline-item">
          <p>{report.visit_date}</p>
        </div>
      {/each}
    </div>
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .viewer-container {
    flex-grow: 1;
    display: flex;
    gap: 1em;
    padding: 1em;
  }
  .viewer-slot {
    flex: 1;
    border: 2px dashed #ccc;
    border-radius: 6px;
    padding: 1em;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .placeholder {
    color: #999;
  }
  .timeline-container {
    flex-shrink: 0;
    height: 150px;
    background: #f0f0f0;
    padding: 1em;
    overflow-x: auto;
    white-space: nowrap;
  }
  .timeline-item {
    display: inline-block;
    width: 150px;
    height: 100px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 6px;
    margin-right: 1em;
    padding: 1em;
    cursor: grab;
    user-select: none;
  }
</style>

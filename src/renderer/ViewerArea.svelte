<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import PdfViewer from './PdfViewer.svelte';
  import UnifiedDataViewer from './UnifiedDataViewer.svelte';
  import type { ViewerSlot } from './stores';

  export let slot: ViewerSlot;

  const dispatch = createEventDispatcher();

  function handleClose() {
    dispatch('close');
  }
</script>

<div class="viewer-area">
  <div class="controls">
    <button on:click={() => slot.viewMode = 'pdf'} class:active={slot.viewMode === 'pdf'}>PDF</button>
    <button on:click={() => slot.viewMode = 'data'} class:active={slot.viewMode === 'data'}>Data</button>
    <button class="close-btn" on:click={handleClose}>X</button>
  </div>

  <div class="content">
    {#if slot.viewMode === 'pdf'}
      <PdfViewer pdfPath={slot.report.pdf_path} />
    {:else}
      <UnifiedDataViewer reportData={slot.report} />
    {/if}
  </div>
</div>

<style>
  .viewer-area {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid #ccc;
    border-radius: 6px;
  }
  .controls {
    display: flex;
    padding: 0.5em;
    background: #f0f0f0;
    border-bottom: 1px solid #ccc;
  }
  .controls button {
    padding: 0.5em 1em;
    border: 1px solid #ccc;
    background: #fff;
    cursor: pointer;
  }
  .controls button.active {
    background: #007bff;
    color: #fff;
  }
  .close-btn {
    margin-left: auto;
    background: #ff6b6b;
    color: white;
    border: none;
  }
  .content {
    flex-grow: 1;
    overflow: auto;
  }
</style>

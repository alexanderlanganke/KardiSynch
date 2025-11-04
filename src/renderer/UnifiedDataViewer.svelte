<script lang="ts">
  export let reportData: any;
</script>

<div class="data-viewer">
  {#if reportData}
    <h2>Unified Report Data</h2>
    <pre>{JSON.stringify(reportData, null, 2)}</pre>
  {:else}
    <p>No data available.</p>
  {/if}
</div>

<style>
  .data-viewer {
    padding: 1em;
  }
  pre {
    background: #f4f4f4;
    padding: 1em;
    border-radius: 5px;
  }
</style>

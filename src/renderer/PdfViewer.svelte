<script lang="ts">
  import { onMount } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';

  export let pdfPath: string;
  let canvas: HTMLCanvasElement;

  onMount(async () => {
    // pdfjsLib requires a worker to be configured.
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    if (pdfPath) {
      try {
        const pdfData = await window.electronAPI.getPdfData(pdfPath);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });

        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        page.render(renderContext);
      } catch (error) {
        console.error('Error rendering PDF:', error);
      }
    }
  });
</script>

<canvas bind:this={canvas}></canvas>

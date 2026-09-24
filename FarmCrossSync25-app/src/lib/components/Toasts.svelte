<script lang="ts">
  import { dismissToast, toasts } from "$lib/errors";
  import Toast from "./Toast.svelte";
</script>

{#if $toasts.length > 0}
  <div class="toasts" aria-live="polite" aria-label="Notifications">
    {#each $toasts as toast (toast.id)}
      <Toast {toast} onDismiss={dismissToast} />
    {/each}
  </div>
{/if}

<style>
  .toasts {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(24rem, calc(100vw - 2rem));
    z-index: 1000;
  }
</style>

<script lang="ts">
  import type { Toast } from "$lib/errors";
  import Icon from "./Icon.svelte";

  interface Props {
    toast: Toast;
    onDismiss: (id: number) => void;
  }

  let { toast, onDismiss }: Props = $props();
</script>

<div class="toast" class:error={!!toast.key} role="alert" data-error={toast.key ?? ""}>
  <span class="toast-icon"><Icon name={toast.key ? "alert" : "info"} size={16} /></span>
  <span class="text">{toast.message}</span>
  <button class="ghost close" onclick={() => onDismiss(toast.id)} aria-label="Dismiss">
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.75rem 0.5rem 0.75rem 0.85rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    animation: pop-in 0.18s ease-out;
  }
  .toast-icon {
    display: inline-flex;
    padding-top: 0.1rem;
    color: var(--info);
  }
  .toast.error .toast-icon {
    color: var(--danger);
  }
  .text {
    flex: 1;
    color: var(--text-soft);
  }
  .close {
    padding: 0.25rem;
    margin-top: -0.1rem;
  }
</style>

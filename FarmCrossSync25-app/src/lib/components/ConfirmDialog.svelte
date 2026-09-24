<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    message: string;
    onResolve: (confirmed: boolean) => void;
    /** Action-specific label so the destructive choice is never just "Confirm". */
    confirmLabel?: string;
  }

  let { message, onResolve, confirmLabel = "Confirm" }: Props = $props();

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onResolve(false);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop">
  <div class="modal" role="alertdialog" aria-modal="true" aria-label="Confirm action">
    <span class="modal-icon danger"><Icon name="alert" size={20} /></span>
    <h2>Are you sure?</h2>
    <p>{message}</p>
    <div class="modal-actions">
      <button class="ghost" onclick={() => onResolve(false)}>Cancel</button>
      <button class="danger" onclick={() => onResolve(true)}>{confirmLabel}</button>
    </div>
  </div>
</div>

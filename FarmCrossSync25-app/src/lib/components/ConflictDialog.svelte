<script lang="ts">
  import { CONFLICT_MESSAGE, type ConflictChoice } from "$lib/conflict";
  import Icon from "./Icon.svelte";

  interface Props {
    onChoose: (choice: ConflictChoice) => void;
    message?: string;
  }

  let { onChoose, message = CONFLICT_MESSAGE }: Props = $props();

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onChoose("cancel");
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop">
  <div class="modal" role="alertdialog" aria-modal="true" aria-label="Save conflict">
    <span class="modal-icon warn"><Icon name="alert" size={20} /></span>
    <h2>Save conflict</h2>
    <p>{message}</p>
    <div class="choices">
      <button class="choice" onclick={() => onChoose("keep")}>
        <Icon name="save" />
        <span><strong>Keep My Save</strong><small>Leave your local save as it is.</small></span>
      </button>
      <button class="choice" onclick={() => onChoose("download")}>
        <Icon name="download" />
        <span>
          <strong>Download Cloud Save</strong>
          <small>Replace it — a backup is made first.</small>
        </span>
      </button>
    </div>
    <div class="modal-actions">
      <button class="ghost" onclick={() => onChoose("cancel")}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .choices {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .choice {
    justify-content: flex-start;
    gap: 0.8rem;
    padding: 0.75rem 0.9rem;
    text-align: left;
    white-space: normal;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .choice span {
    display: flex;
    flex-direction: column;
  }
  .choice small {
    color: var(--muted);
    font-weight: 400;
    font-size: 0.85em;
  }
  .modal-actions {
    margin-top: 0.75rem;
  }
</style>

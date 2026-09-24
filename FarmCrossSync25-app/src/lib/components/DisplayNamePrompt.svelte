<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    onSubmit: (name: string) => void;
    error?: string | null;
    busy?: boolean;
  }

  let { onSubmit, error = null, busy = false }: Props = $props();
  let name = $state("");

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  }
</script>

<div class="modal-backdrop">
  <div class="modal" role="dialog" aria-modal="true" aria-label="Display name">
    <form onsubmit={handleSubmit}>
      <span class="modal-icon"><Icon name="users" size={20} /></span>
      <h2>What should your friends see you as?</h2>
      <p>No account or email needed — just a name for your farm mates.</p>
      {#if error}
        <p role="alert">{error}</p>
      {/if}
      <input
        bind:value={name}
        placeholder="Display name"
        aria-label="Display name"
        maxlength="32"
        disabled={busy}
      />
      <div class="modal-actions">
        <button type="submit" class="primary" disabled={busy || !name.trim()}>
          {busy ? "Registering…" : "Continue"}
        </button>
      </div>
    </form>
  </div>
</div>

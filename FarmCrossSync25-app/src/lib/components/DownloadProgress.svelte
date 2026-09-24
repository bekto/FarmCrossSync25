<script lang="ts">
  import type { DownloadPhase } from "$lib/download";
  import { relativeTime } from "$lib/format";
  import Icon from "./Icon.svelte";

  interface Props {
    phase?: DownloadPhase | null;
    percent?: number;
    syncedAt?: string | null;
  }

  let { phase = null, percent = 0, syncedAt = null }: Props = $props();

  const LABELS: Record<DownloadPhase, string> = {
    confirming: "Confirming…",
    downloading: "Fetching the cloud save…",
    unpacking: "Unpacking…",
    verifying: "Verifying…",
    replacing: "Replacing your save…",
  };
  const ORDER = Object.keys(LABELS) as DownloadPhase[];
  const step = $derived(phase ? ORDER.indexOf(phase) : 0);
</script>

{#if syncedAt}
  <p class="progress-card done success">
    <Icon name="check" />
    Downloaded <time datetime={syncedAt} title={syncedAt}>{relativeTime(syncedAt)}</time>
  </p>
{:else if phase}
  <div class="progress-card">
    <div class="head">
      <Icon name="download" />
      <strong>{LABELS[phase]}{percent > 0 ? ` ${percent}%` : ""}</strong>
      <span class="step">Step {step + 1} of {ORDER.length}</span>
    </div>
    <progress value={percent} max="100"></progress>
    <p class="note"><Icon name="shield" size={13} />An existing save is backed up before it is replaced.</p>
  </div>
{/if}

<style>
  .progress-card {
    width: min(30rem, 100%);
    margin: 0;
    padding: 0.85rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    animation: pop-in 0.18s ease-out;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: auto;
    font-weight: 600;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
    color: var(--accent);
  }
  .head strong {
    color: var(--text);
  }
  .step {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.85em;
  }
  .note {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.55rem 0 0;
    font-size: 0.82em;
    color: var(--muted);
  }
</style>

<script lang="ts">
  import type { UploadPhase } from "$lib/upload";
  import { relativeTime } from "$lib/format";
  import Icon from "./Icon.svelte";

  interface Props {
    phase?: UploadPhase | null;
    percent?: number;
    uploadedAt?: string | null;
  }

  let { phase = null, percent = 0, uploadedAt = null }: Props = $props();

  // Two phases: zipping fills the first half of the overall bar, upload the rest.
  const overall = $derived(phase === "uploading" ? 50 + percent / 2 : percent / 2);
</script>

{#if uploadedAt}
  <p class="progress-card done success">
    <Icon name="check" />
    Uploaded <time datetime={uploadedAt} title={uploadedAt}>{relativeTime(uploadedAt)}</time>
  </p>
{:else if phase}
  <div class="progress-card">
    <div class="head">
      <Icon name="upload" />
      <strong>Uploading your save</strong>
      <span class="pct">{Math.round(overall)}%</span>
    </div>
    <progress value={overall} max="100"></progress>
    <ol class="phases">
      <li class:active={phase === "zipping"} class:done={phase === "uploading"}>
        Zipping save…{phase === "zipping" ? ` ${percent}%` : ""}
      </li>
      <li class:active={phase === "uploading"}>
        Uploading…{phase === "uploading" ? ` ${percent}%` : ""}
      </li>
    </ol>
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
  .pct {
    margin-left: auto;
    color: var(--text-soft);
    font-variant-numeric: tabular-nums;
  }
  .phases {
    display: flex;
    gap: 1.25rem;
    margin: 0.55rem 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.85em;
    color: var(--muted);
  }
  .phases li.active {
    color: var(--text);
  }
  .phases li.done {
    color: var(--accent);
  }
</style>

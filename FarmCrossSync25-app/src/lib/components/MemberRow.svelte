<script lang="ts">
  import type { PlayerRow } from "$lib/farmScreen";
  import { formatBytes, initials, relativeTime } from "$lib/format";
  import Icon from "./Icon.svelte";

  interface Props {
    row: PlayerRow;
    /** True for the viewer's own row; shows a "You" tag. */
    isYou?: boolean;
    canDownload?: boolean;
    onDownload?: (row: PlayerRow) => void;
    /** Owner-only actions; false for non-owners and the owner's own row. */
    canMakeOwner?: boolean;
    canKick?: boolean;
    onMakeOwner?: (row: PlayerRow) => void;
    onKick?: (row: PlayerRow) => void;
  }

  let {
    row,
    isYou = false,
    canDownload = false,
    onDownload,
    canMakeOwner = false,
    canKick = false,
    onMakeOwner,
    onKick,
  }: Props = $props();
</script>

<li class="member-row">
  <span class="avatar" aria-hidden="true">{initials(row.display_name)}</span>
  <div class="who">
    <span class="name">
      <span class="name-text">{row.display_name}</span>
      {#if isYou}<span class="tag you">You</span>{/if}
      {#if row.isOwner}
        <span class="tag owner"><Icon name="crown" size={11} />Owner</span>
      {/if}
    </span>
    <span class="detail" title={row.lastUploadAt ?? "never uploaded"}>
      {#if row.lastUploadAt}
        Uploaded {relativeTime(row.lastUploadAt)}
        {#if row.save}· {formatBytes(row.save.file_size)}{/if}
      {:else}
        No uploads yet
      {/if}
    </span>
  </div>
  <span class="actions">
    {#if canMakeOwner}
      <button class="ghost sm" onclick={() => onMakeOwner?.(row)}>Make owner</button>
    {/if}
    {#if canKick}
      <button class="danger ghost sm" onclick={() => onKick?.(row)}>Kick</button>
    {/if}
    {#if canDownload}
      <button
        class="outline download"
        onclick={() => onDownload?.(row)}
        disabled={!row.save}
        title={row.save ? `Download ${row.display_name}'s save` : "Nothing uploaded yet"}
      >
        <Icon name="download" size={15} />
        Download
      </button>
    {/if}
  </span>
</li>

<style>
  .member-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--radius);
  }
  .member-row:hover {
    background: var(--surface-2);
  }
  .member-row + :global(.member-row) {
    border-top: 1px solid var(--border);
  }
  .member-row:hover + :global(.member-row) {
    border-top-color: transparent;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    font-weight: 600;
  }
  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    font-size: 0.7em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tag.owner {
    background: var(--gold-soft);
    color: var(--gold);
  }
  .tag.you {
    background: var(--info-soft);
    color: var(--info);
  }
  .detail {
    color: var(--muted);
    font-size: 0.85em;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .actions .download {
    margin-left: 0.25rem;
  }
</style>

<script lang="ts">
  import type { Invite } from "$lib/ownerActions";
  import { EMPTY_STATES } from "$lib/errors";
  import { initials, relativeTime } from "$lib/format";
  import Icon from "./Icon.svelte";

  interface Props {
    invites: Invite[];
    loading?: boolean;
    error?: string | null;
    busy?: boolean;
    onAccept: (inviteId: string) => void;
    onDeny: (inviteId: string) => void;
  }

  let {
    invites,
    loading = false,
    error = null,
    busy = false,
    onAccept,
    onDeny,
  }: Props = $props();
</script>

<section class="card join-requests" class:pending={invites.length > 0}>
  <header class="head">
    <span class="head-icon"><Icon name="userPlus" size={16} /></span>
    <h2>Join requests</h2>
    {#if invites.length > 0}
      <span class="count">{invites.length}</span>
    {/if}
  </header>
  {#if error}
    <p class="banner error" role="alert"><Icon name="alert" />{error}</p>
  {/if}
  {#if loading && invites.length === 0}
    <p class="muted note">Loading requests…</p>
  {/if}
  {#if !loading && invites.length === 0}
    <p class="muted note">{EMPTY_STATES.noRequests}</p>
  {/if}
  {#if invites.length > 0}
    <ul>
      {#each invites as invite (invite.id)}
        <li>
          <span class="avatar" aria-hidden="true">{initials(invite.display_name)}</span>
          <div class="who">
            <span class="name">{invite.display_name}</span>
            <time class="muted" datetime={invite.created_at}>
              requested {relativeTime(invite.created_at)}
            </time>
          </div>
          <span class="actions">
            <button class="danger ghost sm" onclick={() => onDeny(invite.id)} disabled={busy}>
              <Icon name="x" size={14} />Deny
            </button>
            <button class="primary sm" onclick={() => onAccept(invite.id)} disabled={busy}>
              <Icon name="check" size={14} />Accept
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .join-requests {
    padding: 1rem 1.2rem;
  }
  .join-requests.pending {
    border-color: color-mix(in srgb, var(--gold) 50%, var(--border));
    background: linear-gradient(var(--gold-soft), transparent 70%), var(--surface);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .head-icon {
    display: inline-flex;
    padding: 0.35rem;
    border-radius: 8px;
    background: var(--gold-soft);
    color: var(--gold);
  }
  .count {
    min-width: 1.4rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--gold);
    color: var(--bg);
    font-size: 0.78em;
    font-weight: 700;
    text-align: center;
  }
  .note {
    margin: 0.6rem 0 0;
  }
  .banner {
    margin-top: 0.6rem;
  }
  ul {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.7rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  li .avatar {
    color: var(--gold);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .who .muted {
    font-size: 0.85em;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-left: auto;
  }
</style>

<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  /* Theme contract: the only place colors live (enforced by audit:styles).
     Warm dark "field at dusk" palette — fresh-crop green for primary actions,
     harvest gold for owner/attention, soft red for anything destructive. */
  :global(:root) {
    color-scheme: dark;
    --bg: #0d0f0e;
    --surface: #151917;
    --surface-2: #1c211e;
    --surface-3: #252b27;
    --border: #262d29;
    --border-strong: #37403a;
    --text: #e9ede9;
    --text-soft: #c3cbc5;
    --muted: #8a968e;
    --accent: #6fcf5b;
    --accent-hover: #86dd73;
    --accent-ink: #0b1a08;
    --accent-soft: rgb(111 207 91 / 0.12);
    --accent-glow: rgb(111 207 91 / 0.28);
    --gold: #e8b04a;
    --gold-soft: rgb(232 176 74 / 0.13);
    --info: #6cb4ff;
    --info-soft: rgb(108 180 255 / 0.12);
    --warn: #e8b04a;
    --warn-soft: rgb(232 176 74 / 0.13);
    --danger: #f2685f;
    --danger-soft: rgb(242 104 95 / 0.12);
    --backdrop: rgb(5 7 6 / 0.72);
    --hero-glow: radial-gradient(
      120% 140% at 0% 0%,
      rgb(111 207 91 / 0.16),
      transparent 55%
    );
    --radius-sm: 6px;
    --radius: 9px;
    --radius-lg: 14px;
    --shadow: 0 10px 30px rgb(0 0 0 / 0.5);
    --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
    --sidebar-w: 14.5rem;
    --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, monospace;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  :global(html) {
    scrollbar-color: var(--border-strong) transparent;
  }
  :global(h1, h2, h3) {
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  :global(a) {
    color: var(--info);
  }
  :global(code, pre) {
    font-family: var(--mono);
  }
  :global(::selection) {
    background: var(--accent-glow);
  }

  /* --- Controls ---------------------------------------------------------- */
  :global(button),
  :global(select),
  :global(input) {
    font: inherit;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 0.5rem 0.85rem;
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s,
      box-shadow 0.12s;
  }
  :global(input::placeholder) {
    color: var(--muted);
  }
  :global(input:hover:not(:disabled)),
  :global(select:hover:not(:disabled)) {
    border-color: var(--muted);
  }
  :global(input:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  :global(button:hover:not(:disabled)) {
    background: var(--surface-3);
    border-color: var(--muted);
  }
  :global(button:active:not(:disabled)) {
    transform: translateY(1px);
  }
  :global(button:disabled),
  :global(input:disabled),
  :global(select:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }
  :global(button.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 4px 14px var(--accent-soft);
  }
  :global(button.primary:hover:not(:disabled)) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    box-shadow: 0 4px 18px var(--accent-glow);
  }
  :global(button.outline) {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }
  :global(button.outline:hover:not(:disabled)) {
    background: var(--accent-soft);
    border-color: var(--accent-hover);
  }
  :global(button.ghost) {
    background: transparent;
    border-color: transparent;
    color: var(--text-soft);
  }
  :global(button.ghost:hover:not(:disabled)) {
    background: var(--surface-3);
    border-color: transparent;
    color: var(--text);
  }
  :global(button.danger) {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
    background: var(--danger-soft);
  }
  :global(button.danger:hover:not(:disabled)) {
    background: var(--danger);
    color: var(--bg);
    border-color: var(--danger);
  }
  :global(button.danger.ghost) {
    background: transparent;
    border-color: transparent;
  }
  :global(button.danger.ghost:hover:not(:disabled)) {
    background: var(--danger-soft);
    color: var(--danger);
  }
  :global(button.lg) {
    padding: 0.7rem 1.3rem;
    font-size: 1.02em;
    border-radius: var(--radius-lg);
  }
  :global(button.sm) {
    padding: 0.3rem 0.6rem;
    font-size: 0.9em;
  }
  :global(button:focus-visible),
  :global(select:focus-visible),
  :global(a:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* --- Shared surfaces ---------------------------------------------------- */
  :global(.card) {
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  :global(.eyebrow) {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  :global(.muted) {
    color: var(--muted);
  }
  :global(.success) {
    color: var(--accent);
  }
  :global(p[role="alert"]) {
    color: var(--danger);
  }
  :global(.banner) {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    margin: 0;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-soft);
  }
  :global(.banner.error) {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    background: var(--danger-soft);
  }
  :global(.banner.ok) {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: var(--accent-soft);
  }
  :global(.banner.warn) {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    background: var(--warn-soft);
  }
  :global(.avatar) {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: linear-gradient(145deg, var(--surface-3), var(--surface-2));
    border: 1px solid var(--border-strong);
    color: var(--accent);
    font-size: 0.8em;
    font-weight: 700;
  }

  /* --- Progress ----------------------------------------------------------- */
  :global(progress) {
    display: block;
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-3);
    appearance: none;
  }
  :global(progress::-webkit-progress-bar) {
    background: var(--surface-3);
    border-radius: 999px;
  }
  :global(progress::-webkit-progress-value) {
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.2s;
  }
  :global(progress::-moz-progress-bar) {
    background: var(--accent);
    border-radius: 999px;
  }

  /* --- Modals ------------------------------------------------------------- */
  :global(.modal-backdrop) {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--backdrop);
    backdrop-filter: blur(4px);
    animation: fade-in 0.15s ease-out;
  }
  :global(.modal) {
    width: min(28rem, 100%);
    max-height: calc(100vh - 2rem);
    overflow: auto;
    padding: 1.4rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    animation: pop-in 0.18s ease-out;
  }
  :global(.modal-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    margin-bottom: 0.85rem;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  :global(.modal-icon.danger) {
    background: var(--danger-soft);
    color: var(--danger);
  }
  :global(.modal-icon.warn) {
    background: var(--warn-soft);
    color: var(--warn);
  }
  :global(.modal h2) {
    margin: 0 0 0.45rem;
    font-size: 1.15rem;
  }
  :global(.modal p) {
    margin: 0 0 0.75rem;
    color: var(--text-soft);
  }
  :global(.modal input) {
    width: 100%;
    margin: 0.25rem 0 0.5rem;
  }
  :global(.modal-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }

  @keyframes -global-fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes -global-pop-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      animation: none !important;
      transition: none !important;
    }
  }
</style>

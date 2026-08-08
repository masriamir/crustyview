<script lang="ts" generics="T extends string">
  interface Option {
    value: T;
    label: string;
    disabled?: boolean;
    disabledReason?: string;
  }
  interface Props {
    options: Option[];
    value: T;
    onchange: (value: T) => void;
    label: string;
  }
  let { options, value, onchange, label }: Props = $props();
</script>

<div class="segmented" role="group" aria-label={label}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="segment"
      aria-pressed={opt.value === value}
      aria-disabled={opt.disabled ? true : undefined}
      title={opt.disabled ? opt.disabledReason : undefined}
      onclick={() => {
        if (!opt.disabled && opt.value !== value) onchange(opt.value);
      }}
    >
      {opt.label}{#if opt.disabled && opt.disabledReason}
        <span class="visually-hidden">— {opt.disabledReason}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .segment {
    min-width: var(--touch-target);
    min-height: calc(var(--touch-target) - 8px);
    border: 0;
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    padding: 0 1rem;
    font-size: 0.9rem;
    transition: background var(--transition);
  }
  .segment + .segment {
    border-left: 1px solid var(--border);
  }
  .segment[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .segment[aria-disabled='true'] {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  @media (max-width: 48rem) {
    .segment {
      min-height: var(--touch-target);
    }
  }
</style>

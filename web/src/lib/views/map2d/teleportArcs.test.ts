import { describe, it, expect } from 'vitest';
import {
  arcCapLabel,
  arcCapName,
  isTeleportArcCap,
  selectArcs,
  stepArcCap,
  TELEPORT_ARC_CAPS,
  type TeleportArcCap,
  type TeleportLink,
} from './teleportArcs';

/** A link whose chord length is `len` along the x axis, at a distinct y so
 *  fixtures stay identifiable after sorting. */
const link = (len: number, y: number): TeleportLink => ({ from: [0, y], to: [len, y] });

describe('stepArcCap', () => {
  it('walks the ladder in both directions', () => {
    expect(stepArcCap(100, 1)).toBe(200);
    expect(stepArcCap(100, -1)).toBe(50);
  });

  it('clamps at both ends rather than wrapping', () => {
    // Wrapping would send a user who wanted "a bit fewer" straight to `all`,
    // which is the slowest setting on the ladder.
    expect(stepArcCap(25, -1)).toBe(25);
    expect(stepArcCap('all', 1)).toBe('all');
  });

  it('reaches every rung', () => {
    // Annotated: indexing an `as const` tuple yields a literal type that `let`
    // does not widen (it's not a "fresh" literal), so an unannotated `cap`
    // would be pinned to `25` and reject `stepArcCap`'s wider return type.
    // Runtime behavior is unchanged — Vitest doesn't type-check, so this only
    // surfaces under `svelte-check` (brief transcription defect, see task-1-report.md).
    let cap: TeleportArcCap = TELEPORT_ARC_CAPS[0];
    // Also annotated: `seen`'s element type would otherwise be inferred from
    // `cap`'s narrowed type at this point (`25`), not its declared type.
    const seen: TeleportArcCap[] = [cap];
    for (let i = 0; i < TELEPORT_ARC_CAPS.length; i++) {
      cap = stepArcCap(cap, 1);
      if (cap !== seen[seen.length - 1]) seen.push(cap);
    }
    expect(seen).toEqual([...TELEPORT_ARC_CAPS]);
  });
});

describe('isTeleportArcCap', () => {
  it('accepts every ladder value', () => {
    for (const cap of TELEPORT_ARC_CAPS) expect(isTeleportArcCap(cap)).toBe(true);
  });

  it('rejects stored junk', () => {
    // `localStorage` is attacker-writable, so this guards the constructor.
    expect(isTeleportArcCap(75)).toBe(false);
    expect(isTeleportArcCap('100')).toBe(false);
    expect(isTeleportArcCap(null)).toBe(false);
    expect(isTeleportArcCap({})).toBe(false);
  });
});

describe('selectArcs', () => {
  const links = [link(10, 0), link(50, 1), link(30, 2), link(40, 3)];

  it('returns everything under the cap, untouched', () => {
    // Identity matters: the common case must not pay for a sort or a copy.
    expect(selectArcs(links, 100)).toBe(links);
  });

  it('returns everything when the cap is `all`', () => {
    expect(selectArcs(links, 'all')).toBe(links);
  });

  it('keeps the longest chords when the cap bites', () => {
    // Longest-first is the whole point: at fit zoom a short link draws as a
    // dot, so capping by shortest renders an overlay that looks switched off.
    const picked = selectArcs(links, 2);
    expect(picked.map((l) => l.to[0])).toEqual([50, 40]);
  });

  it('is deterministic across repeated calls', () => {
    // The cached tile and a direct render must agree pixel for pixel, so the
    // same N have to come back every time.
    const a = selectArcs(links, 2).map((l) => l.to[1]);
    const b = selectArcs(links, 2).map((l) => l.to[1]);
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const original = [...links];
    selectArcs(links, 2);
    expect(links).toEqual(original);
  });

  it('measures chords in both axes', () => {
    const diagonal: TeleportLink[] = [
      { from: [0, 0], to: [0, 100] },
      { from: [0, 0], to: [3, 4] },
    ];
    expect(selectArcs(diagonal, 1)[0].to).toEqual([0, 100]);
  });
});

describe('arcCapLabel', () => {
  it('shows the cap alone when the map is under it', () => {
    expect(arcCapLabel(100, 40)).toBe('100');
  });

  it('shows cap and total when the cap bites', () => {
    expect(arcCapLabel(100, 1668)).toBe('100 of 1,668');
  });

  it('shows `all` for the unlimited rung', () => {
    expect(arcCapLabel('all', 1668)).toBe('all');
  });

  it('shows `none` for a map with no links', () => {
    // Not `0`: every other state's number is the CAP, and the smallest rung is
    // 25, so a `0` in that position would read as a cap that cannot exist.
    expect(arcCapLabel(100, 0)).toBe('none');
    expect(arcCapLabel('all', 0)).toBe('none');
  });
});

describe('arcCapName', () => {
  it('speaks values as words, never punctuation', () => {
    // The visible label's `·` and thousands separator must not reach a screen
    // reader (CLAUDE.md, from #74's audit).
    expect(arcCapName(100, 1668)).toBe('Show teleport links, 100 of 1668 drawn');
    expect(arcCapName(100, 40)).toBe('Show teleport links, cap 100');
    expect(arcCapName('all', 1668)).toBe('Show teleport links, all drawn');
    expect(arcCapName(100, 0)).toBe('Show teleport links, none on this map');
  });

  it('contains the control\'s visible label', () => {
    // WCAG 2.5.3: the accessible name must contain the visible label, which is
    // the word "Links" on the button.
    for (const total of [0, 40, 1668]) {
      expect(arcCapName(100, total).toLowerCase()).toContain('links');
    }
  });
});

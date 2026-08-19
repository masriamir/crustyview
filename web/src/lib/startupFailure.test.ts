import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderStartupFailure } from './startupFailure';

/**
 * #188: a wasm startup failure used to be written as bare `textContent` on the
 * mount point — no role, no live region. Nothing was announced, so a
 * screen-reader user got a silent blank page on the one path where the app can
 * tell them nothing else.
 *
 * The two-phase shape is the part worth pinning. An empty `role="alert"` region
 * must be in the DOM *first*, with the message following on a later task, so
 * assistive technology observes a mutation into an existing live region rather
 * than the insertion of an already-populated one. A "simplification" that sets
 * the role and the text together would still look right in the DOM and would
 * still pass a naive test that only checked the final state — so the first test
 * below asserts the region is present *and empty* before timers run.
 *
 * Checked by breaking it on purpose rather than reasoned about: collapsing
 * `renderStartupFailure` to a single phase (set the text, then insert) turns
 * exactly **one** test red — `expected 'Failed to start: …' to be ''` — while
 * the other three stay green. That is precisely the blind spot a final-state
 * assertion would leave open.
 */

let target: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement('div');
  target.id = 'app';
  document.body.append(target);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('renderStartupFailure', () => {
  it('puts an empty alert region in place before the message arrives', () => {
    renderStartupFailure(target, new Error('wasm init exploded'));

    const alert = target.querySelector('[role="alert"]');
    expect(alert, 'an alert region should be inserted synchronously').not.toBeNull();
    // The load-bearing assertion: empty at this point. If the role and the text
    // landed together, the announcement is the unreliable insertion case.
    expect(alert?.textContent).toBe('');
  });

  it('fills the region on a later task', () => {
    renderStartupFailure(target, new Error('wasm init exploded'));
    vi.runAllTimers();

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to start: wasm init exploded',
    );
  });

  it('passes a string rejection through unchanged', () => {
    renderStartupFailure(target, 'plain string rejection');
    vi.runAllTimers();

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to start: plain string rejection',
    );
  });

  it('serializes an object rejection instead of rendering [object Object]', () => {
    // The case this whole helper exists for: a fatal screen whose only job is
    // to give someone something to paste into a bug report must not reduce the
    // cause to `[object Object]`. Caught as a suppressed review comment on
    // #196 — the original test claimed this behavior while passing a string,
    // which `String()` already handles, so it never exercised this path.
    renderStartupFailure(target, { code: 'ENOENT', path: '/wasm' });
    vi.runAllTimers();

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to start: {"code":"ENOENT","path":"/wasm"}',
    );
  });

  it('falls back to String() when the rejection cannot be serialized', () => {
    // `JSON.stringify` throws on a circular structure; the fallback keeps the
    // screen rendering rather than turning a startup failure into a second one.
    const circular: Record<string, unknown> = { code: 'LOOP' };
    circular.self = circular;

    renderStartupFailure(target, circular);
    vi.runAllTimers();

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to start: [object Object]',
    );
  });

  it('renders undefined and null rejections as words rather than blanks', () => {
    // `JSON.stringify(undefined)` returns undefined, not a string — without the
    // `typeof json === 'string'` guard this would render an empty message.
    renderStartupFailure(target, undefined);
    vi.runAllTimers();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe('Failed to start: undefined');

    renderStartupFailure(target, null);
    vi.runAllTimers();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe('Failed to start: null');
  });

  it('replaces whatever was in the mount point', () => {
    target.append(document.createElement('span'));
    renderStartupFailure(target, new Error('boom'));
    vi.runAllTimers();

    // A half-mounted app must not remain alongside a fatal error.
    expect(target.querySelectorAll('span')).toHaveLength(0);
    expect(target.children).toHaveLength(1);
  });
});

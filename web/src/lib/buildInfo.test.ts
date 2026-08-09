import { describe, expect, it } from 'vitest';
import { BUILD_SHA, formatBuild } from './buildInfo';

describe('formatBuild', () => {
  it('joins version and sha', () => {
    expect(formatBuild('0.1.0', 'a1b2c3d')).toBe('v0.1.0 · a1b2c3d');
  });

  it('omits an unknown sha rather than printing the word', () => {
    expect(formatBuild('0.1.0', 'unknown')).toBe('v0.1.0');
  });

  it('omits an empty sha', () => {
    expect(formatBuild('0.1.0', '')).toBe('v0.1.0');
  });
});

describe('BUILD_SHA', () => {
  it('is defined by the Vite config in every mode', () => {
    expect(typeof BUILD_SHA).toBe('string');
    expect(BUILD_SHA.length).toBeGreaterThan(0);
  });
});

// Guards the one thing users can see about what's deployed: the footer version.
// The footer, package.json, and the roadmap step must agree — if a session
// bumps one and forgets the others, this fails before it reaches main.

import pkg from '../../../package.json';
import { APP_VERSION, ROADMAP_STEP, ROADMAP_STEP_NAME } from '../version';
import { WHATS_NEW } from '../whatsNew';

describe('app version', () => {
  it('matches the version in package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('uses the 0.<phase>.<step> roadmap scheme', () => {
    expect(APP_VERSION).toMatch(/^0\.\d+\.\d+$/);
  });

  it('derives from the roadmap step it claims to complete', () => {
    expect(ROADMAP_STEP).toMatch(/^\d+\.\d+$/);
    expect(APP_VERSION).toBe(`0.${ROADMAP_STEP}`);
  });

  it('names the roadmap step so the footer tooltip is meaningful', () => {
    expect(ROADMAP_STEP_NAME.trim().length).toBeGreaterThan(0);
  });

  it('stays within the roadmap: phases 0-10', () => {
    const [phase, step] = ROADMAP_STEP.split('.').map(Number);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThanOrEqual(10);
    expect(step).toBeGreaterThan(0);
  });
});

describe("what's new changelog", () => {
  it('has at least one entry', () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
  });

  it('gives every entry a version, date, and non-empty items', () => {
    WHATS_NEW.forEach((entry) => {
      expect(typeof entry.version).toBe('string');
      expect(entry.version).toMatch(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/);
      expect(typeof entry.date).toBe('string');
      expect(Array.isArray(entry.items)).toBe(true);
      expect(entry.items.length).toBeGreaterThan(0);
      entry.items.forEach((item) => expect(item.trim().length).toBeGreaterThan(0));
    });
  });

  it('is ordered newest first', () => {
    const versions = WHATS_NEW.map((e) => e.version);
    const sorted = [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    expect(versions).toEqual(sorted);
  });

  it('has no duplicate versions', () => {
    const versions = WHATS_NEW.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

import { describe, expect, it } from 'vitest';
import { compareSemver, isAppVersionSupported, parseSemver } from './app-version.js';

describe('app version', () => {
  it('semver parçalarını okur', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
  });

  it('10, 9 dan büyüktür', () => {
    expect(compareSemver('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  it('minimumun altını reddeder, biçimsizi reddeder', () => {
    expect(isAppVersionSupported('1.0.0', '1.0.0')).toBe(true);
    expect(isAppVersionSupported('1.0.1', '1.0.0')).toBe(true);
    expect(isAppVersionSupported('0.9.9', '1.0.0')).toBe(false);
    expect(isAppVersionSupported('abc', '1.0.0')).toBe(false);
  });
});

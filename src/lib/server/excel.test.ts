import { describe, it, expect } from 'vitest';
import { normalizePackage, normalizeDisplay, normalizeMpcKey } from './excel';

describe('normalizePackage', () => {
  // word-only qualifiers must be preserved
  it('preserves IDF qualifier', () => expect(normalizePackage('8LSOIC IDF')).toBe('8SOIC IDF'));
  it('preserves HD qualifier', () => expect(normalizePackage('44L TQFP HD 7x7')).toBe('44TQFP HD'));
  it('preserves UD qualifier', () => expect(normalizePackage('20SSOP UD')).toBe('20SSOP UD'));

  // size specs (contain digit) must be dropped
  it('drops size spec 6X6', () => expect(normalizePackage('36L SQFN 6X6(UDX)')).toBe('36SQFN'));
  it('drops size spec 7x7', () => expect(normalizePackage('44L TQFP 7x7')).toBe('44TQFP'));
  it('drops size spec 3x3', () => expect(normalizePackage('20LVQFN 3x3(REB)')).toBe('20VQFN'));

  // baseline cases
  it('strips L suffix (no space)', () => expect(normalizePackage('8LSOIC')).toBe('8SOIC'));
  it('handles no-L package', () => expect(normalizePackage('44TQFP')).toBe('44TQFP'));
  it('applies EIAJ override', () => expect(normalizePackage('8LEIAJ')).toBe('8SOIJ'));
});

describe('normalizeDisplay', () => {
  it('preserves IDF qualifier', () => expect(normalizeDisplay('8LSOIC IDF')).toBe('8SOIC IDF'));
  it('preserves HD qualifier', () => expect(normalizeDisplay('44L TQFP HD 7x7')).toBe('44TQFP HD'));
  it('drops size spec', () => expect(normalizeDisplay('36L SQFN 6X6(UDX)')).toBe('36SQFN'));
  it('no EIAJ override (display only)', () => expect(normalizeDisplay('8LEIAJ')).toBe('8EIAJ'));
});

describe('normalizeMpcKey', () => {
  it('derives MPC key with qualifier base', () =>
    expect(normalizeMpcKey('8LSOIC IDF(XYZ)')).toBe('8SOIC IDF(XYZ)'));
  it('derives standard MPC key', () =>
    expect(normalizeMpcKey('36L SQFN 6X6(UDX)')).toBe('36SQFN(UDX)'));
  it('returns null when no valid code', () =>
    expect(normalizeMpcKey('8LSOIC IDF')).toBeNull());
});

import { describe, it, expect } from 'vitest';
import { scanDelta, resetAwareTotal } from './delta';

describe('scanDelta', () => {
  it('returns the increment when the counter rises', () => {
    expect(scanDelta(3400, 3772)).toBe(372);
  });

  it('returns the post-reset value when the counter drops (cap reset)', () => {
    // 3,772 -> 233 is a capillary reset, not -3,539
    expect(scanDelta(3772, 233)).toBe(233);
  });

  it('returns 0 for no change', () => {
    expect(scanDelta(500, 500)).toBe(0);
  });
});

describe('resetAwareTotal', () => {
  it('sums a monotonic series as last - baseline', () => {
    // baseline 745, then rising values
    expect(resetAwareTotal(745, [2708, 3079, 3400, 3772])).toBe(3772 - 745);
  });

  it('counts production after a single cap reset', () => {
    // Matches lot MTAI270802525.100 in the screenshot:
    // 745 ->2708->3079->3400->3772 (reset) ->233->598
    const total = resetAwareTotal(745, [2708, 3079, 3400, 3772, 233, 598]);
    // 1963 + 371 + 321 + 372 + 233 (reset) + 365 = 3625
    expect(total).toBe(3625);
  });

  it('handles multiple cap resets in one lot', () => {
    // 0 ->100 (reset) ->40 ->90 (reset) ->10
    expect(resetAwareTotal(0, [100, 40, 90, 10])).toBe(100 + 40 + 50 + 10);
  });

  it('treats a first scan below baseline as a reset (cap changed at shift boundary)', () => {
    // pre-shift baseline 5000, first in-shift scan 120 -> reset already happened
    expect(resetAwareTotal(5000, [120, 300])).toBe(120 + 180);
  });

  it('returns 0 for an empty series', () => {
    expect(resetAwareTotal(745, [])).toBe(0);
  });

  it('carry-over baseline equal to first scan yields no double count', () => {
    // baseline == first value (carry-over heuristic) -> first contributes 0
    expect(resetAwareTotal(2708, [2708, 3079])).toBe(371);
  });
});

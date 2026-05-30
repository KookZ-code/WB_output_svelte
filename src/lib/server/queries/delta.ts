// Reset-aware output from a cumulative counter.
//
// `bonded_unit` is a cumulative counter tied to capillary (cap) lifetime. When
// the capillary is replaced mid-lot, the counter resets to 0 while lot_id stays
// the same. Naive `cur - prev` then goes large-negative, and `MAX - baseline`
// silently drops everything produced after the reset.
//
// Rule: within a time-ordered scan series, a *decrease* in the counter means a
// reset (voided rows are already excluded upstream and the counter never
// decreases legitimately within a lot). The post-reset value is itself the
// production since the reset. This is a lower bound — the unmeasured pre-reset
// tail (counter ran above `prev` before resetting) is not recoverable from scan
// data and is intentionally not estimated. See docs/discussion/cap-reset-output.md.

/** Production for one scan given the previous cumulative counter value. */
export function scanDelta(prev: number, cur: number): number {
  return cur >= prev ? cur - prev : cur;
}

/** Total production across a time-ordered series of cumulative counter values,
 *  starting from `baseline` (the value carried in from before the series). */
export function resetAwareTotal(baseline: number, values: number[]): number {
  let total = 0;
  let prev = baseline;
  for (const v of values) {
    total += scanDelta(prev, v);
    prev = v;
  }
  return total;
}

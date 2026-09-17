// The API requests whose JSON bodies must not change when the feed and
// calendar logic moves into shared server helpers. The golden file
// tests/fixtures/initial-html-api-golden.json was written by running these
// exact cases against the handlers as they were before the refactor.
export const GOLDEN_NOW = '2026-09-17T15:40:00.000Z'; // 2026-09-18 00:40 KST

export const FEED_CASES = [
  '',
  '?date=2026-09-16',
  '?date=2026-09-16&all=1',
  '?all=true',
  '?date=2026-09-15',
  '?date=2026-09-14',
  '?date=2026-09-13',
  '?date=not-a-date',
  '?date=20260916'
];

export const CALENDAR_CASES = [
  '',
  '?year=2026&month=9',
  '?year=2026&month=10',
  '?year=2027&month=1',
  '?year=2028&month=1',
  '?year=2026&month=13',
  '?year=abc&month=9'
];

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addSittingMs,
  buildStatsView,
  increment,
  normalizeStats,
  pruneStats,
} = require('../src/shared/stats');
const { dayKey } = require('../src/shared/schedule');

function localDate(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test('accumulates sitting time into the local day', () => {
  const now = localDate(2026, 10, 20);
  const stats = {};
  addSittingMs(stats, now, 65_000);
  addSittingMs(stats, now, 5_000);
  assert.equal(stats[dayKey(now)].sittingMs, 70_000);
});

test('increments counters and rejects unknown fields', () => {
  const now = localDate(2026, 10, 20);
  const stats = {};
  increment(stats, now, 'snoozes');
  increment(stats, now, 'breaksCompleted', 2);
  assert.equal(stats[dayKey(now)].snoozes, 1);
  assert.equal(stats[dayKey(now)].breaksCompleted, 2);
  assert.throws(() => increment(stats, now, 'notAStat'), /Unknown statistic field/);
});

test('builds a Monday-to-Sunday weekly overview', () => {
  const now = localDate(2026, 10, 21, 15);
  const stats = {
    '2026-10-19': {
      sittingMs: 3_600_000,
      remindersShown: 2,
      snoozes: 1,
      breaksStarted: 2,
      breaksCompleted: 2,
    },
    '2026-10-20': {
      sittingMs: 7_200_000,
      remindersShown: 4,
      snoozes: 0,
      breaksStarted: 4,
      breaksCompleted: 3,
    },
    '2026-10-21': {
      sittingMs: 1_800_000,
      remindersShown: 1,
      snoozes: 0,
      breaksStarted: 1,
      breaksCompleted: 1,
    },
  };
  const view = buildStatsView(stats, now);
  assert.equal(view.today.key, '2026-10-21');
  assert.equal(view.week.days.length, 7);
  assert.equal(view.week.days[0].key, '2026-10-19');
  assert.equal(view.week.days[2].isToday, true);
  assert.equal(view.week.days[3].isFuture, true);
  assert.equal(view.week.totals.sittingMs, 12_600_000);
  assert.equal(view.week.totals.breaksStarted, 7);
  assert.equal(view.week.totals.breaksCompleted, 6);
  assert.equal(view.week.totals.completionRate, 86);
  assert.equal(view.week.totals.snoozes, 1);
});

test('a day without data is safe in summaries', () => {
  const now = localDate(2026, 10, 21);
  const view = buildStatsView({}, now);
  assert.equal(view.today.sittingMs, 0);
  assert.equal(view.week.totals.completionRate, 0);
});

test('normalization removes malformed entries and bad counts', () => {
  const now = localDate(2026, 10, 21);
  const normalized = normalizeStats(
    {
      'not-a-date': { sittingMs: 1000 },
      '2026-10-20': { sittingMs: -5, snoozes: '2', breaksCompleted: 1.9 },
    },
    now,
  );
  assert.equal(normalized['not-a-date'], undefined);
  assert.equal(normalized['2026-10-20'].sittingMs, 0);
  assert.equal(normalized['2026-10-20'].snoozes, 2);
  assert.equal(normalized['2026-10-20'].breaksCompleted, 1);
});

test('prunes records outside the retention window', () => {
  const now = localDate(2026, 10, 21);
  const stats = {
    '2026-09-01': { sittingMs: 1 },
    '2026-09-21': { sittingMs: 2 },
    '2026-09-22': { sittingMs: 3 },
    '2026-10-21': { sittingMs: 4 },
  };
  pruneStats(stats, now, 30);
  assert.equal(stats['2026-09-01'], undefined);
  assert.equal(stats['2026-09-21'], undefined);
  assert.equal(stats['2026-09-22'].sittingMs, 3);
  assert.equal(stats['2026-10-21'].sittingMs, 4);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SCHEDULE, clone } = require('../src/shared/defaults');
const {
  dayKey,
  findNextWorkStart,
  pauseUntilFor,
  resolveSchedule,
} = require('../src/shared/schedule');

function localDate(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// 2026-10-19 is a Monday.
const MONDAY_0800 = localDate(2026, 10, 19, 8, 0);
const MONDAY_1000 = localDate(2026, 10, 19, 10, 0);
const MONDAY_1230 = localDate(2026, 10, 19, 12, 30);
const MONDAY_1400 = localDate(2026, 10, 19, 14, 0);
const MONDAY_1800 = localDate(2026, 10, 19, 18, 0);
const SATURDAY_1000 = localDate(2026, 10, 24, 10, 0);
const TUESDAY_0900 = localDate(2026, 10, 20, 9, 0);

test('formats local day keys', () => {
  assert.equal(dayKey(MONDAY_1000), '2026-10-19');
});

test('resolves before-work as off with today as next start', () => {
  const view = resolveSchedule(MONDAY_0800, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'off');
  assert.equal(view.reason, 'before-work');
  assert.equal(view.nextStartAt, localDate(2026, 10, 19, 9, 0));
});

test('resolves morning work with lunch as the next boundary', () => {
  const view = resolveSchedule(MONDAY_1000, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'active');
  assert.equal(view.activeUntilAt, localDate(2026, 10, 19, 12, 0));
});

test('resolves lunch and its resume time', () => {
  const view = resolveSchedule(MONDAY_1230, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'lunch');
  assert.equal(view.nextStartAt, localDate(2026, 10, 19, 13, 30));
});

test('resolves afternoon work until quitting time', () => {
  const view = resolveSchedule(MONDAY_1400, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'active');
  assert.equal(view.activeUntilAt, MONDAY_1800);
});

test('resolves after-hours as off with the next workday start', () => {
  const view = resolveSchedule(MONDAY_1800, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'off');
  assert.equal(view.reason, 'after-work');
  assert.equal(view.nextStartAt, TUESDAY_0900);
});

test('skips the weekend when finding the next work start', () => {
  const view = resolveSchedule(SATURDAY_1000, DEFAULT_SCHEDULE);
  assert.equal(view.kind, 'off');
  assert.equal(view.reason, 'non-workday');
  assert.equal(view.nextStartAt, localDate(2026, 10, 26, 9, 0));
});

test('supports schedules without lunch', () => {
  const schedule = clone(DEFAULT_SCHEDULE);
  schedule.lunchEnabled = false;
  const view = resolveSchedule(MONDAY_1230, schedule);
  assert.equal(view.kind, 'active');
  assert.equal(view.activeUntilAt, MONDAY_1800);
});

test('finds the next work start across custom workdays', () => {
  const schedule = clone(DEFAULT_SCHEDULE);
  schedule.workdays = [0, 3];
  assert.equal(findNextWorkStart(MONDAY_1000, schedule), localDate(2026, 10, 21, 9, 0));
});

test('pausing for today ends at quitting time', () => {
  assert.equal(
    pauseUntilFor(MONDAY_1000, DEFAULT_SCHEDULE, 'today'),
    MONDAY_1800,
  );
});

test('pausing outside work ends at the next work start', () => {
  assert.equal(
    pauseUntilFor(MONDAY_1800, DEFAULT_SCHEDULE, 'today'),
    TUESDAY_0900,
  );
});

test('pause duration is relative to now', () => {
  assert.equal(
    pauseUntilFor(MONDAY_1000, DEFAULT_SCHEDULE, 30),
    MONDAY_1000 + 30 * 60 * 1000,
  );
});

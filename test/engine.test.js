'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PHASES, clone, createDefaultSettings } = require('../src/shared/defaults');
const { ReminderEngine } = require('../src/shared/engine');

const MINUTE = 60 * 1000;
const DAY = 20;

function at(hour, minute = 0, day = DAY) {
  return new Date(2026, 9, day, hour, minute, 0, 0).getTime();
}

function makeEngine(start, options = {}) {
  const settings = createDefaultSettings();
  if (options.sitMinutes) settings.rhythm.sitMinutes = options.sitMinutes;
  if (options.standMinutes) settings.rhythm.standMinutes = options.standMinutes;
  if (options.schedule) settings.schedule = clone(options.schedule);
  return new ReminderEngine({
    settings,
    now: start,
    durations: options.durations || null,
  });
}

function eventTypes(events) {
  return events.map((event) => event.type);
}

test('starts a full sitting cycle in an active work window', () => {
  const now = at(10, 0);
  const engine = makeEngine(now);
  const snapshot = engine.getSnapshot(now);
  assert.equal(snapshot.phase, PHASES.SITTING);
  assert.equal(snapshot.dueAt, now + 45 * MINUTE);
  assert.equal(snapshot.remainingMs, 45 * MINUTE);
  assert.equal(snapshot.countingSitting, true);
});

test('starts idle before work and begins a cycle at work start', () => {
  const engine = makeEngine(at(8, 0));
  assert.equal(engine.getSnapshot(at(8, 0)).phase, PHASES.IDLE);
  const events = engine.tick(at(9, 0));
  assert.deepEqual(eventTypes(events), []);
  assert.equal(engine.getSnapshot(at(9, 0)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(9, 0)).dueAt, at(9, 45));
});

test('enters lunch at noon and dismisses a reminder', () => {
  const engine = makeEngine(at(11, 30), { sitMinutes: 20 });
  engine.tick(at(11, 50));
  assert.equal(engine.getSnapshot(at(11, 50)).phase, PHASES.REMINDER);
  const events = engine.tick(at(12, 0));
  assert.ok(eventTypes(events).includes('dismissReminder'));
  assert.equal(engine.getSnapshot(at(12, 0)).phase, PHASES.LUNCH);
  assert.equal(engine.getSnapshot(at(12, 0)).nextStartAt, at(13, 30));
});

test('begins a new cycle after lunch', () => {
  const engine = makeEngine(at(12, 30));
  assert.equal(engine.getSnapshot(at(12, 30)).phase, PHASES.LUNCH);
  engine.tick(at(13, 30));
  assert.equal(engine.getSnapshot(at(13, 30)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(13, 30)).dueAt, at(14, 15));
});

test('stops at quitting time', () => {
  const engine = makeEngine(at(17, 30));
  engine.tick(at(18, 0));
  assert.equal(engine.getSnapshot(at(18, 0)).phase, PHASES.IDLE);
  assert.equal(engine.isCountingSitting(at(18, 1)), false);
});

test('stays idle on a non-workday', () => {
  const engine = makeEngine(at(10, 0, 24));
  const snapshot = engine.getSnapshot(at(10, 0, 24));
  assert.equal(snapshot.phase, PHASES.IDLE);
  assert.equal(snapshot.scheduleReason, 'non-workday');
});

test('fires a reminder once and escalates without auto-starting a break', () => {
  const engine = makeEngine(at(10, 0));
  const due = engine.tick(at(10, 45));
  assert.deepEqual(eventTypes(due), ['reminder']);
  assert.equal(due[0].level, 0);
  assert.equal(engine.getSnapshot(at(10, 45)).phase, PHASES.REMINDER);

  assert.deepEqual(eventTypes(engine.tick(at(10, 45))), []);
  const firstEscalation = engine.tick(at(10, 46));
  assert.deepEqual(eventTypes(firstEscalation), ['reminderEscalated']);
  assert.equal(firstEscalation[0].level, 1);
  const secondEscalation = engine.tick(at(10, 47));
  assert.deepEqual(eventTypes(secondEscalation), ['reminderEscalated']);
  assert.equal(secondEscalation[0].level, 2);
  assert.deepEqual(eventTypes(engine.tick(at(10, 55))), []);
  assert.equal(engine.getSnapshot(at(10, 55)).phase, PHASES.REMINDER);
});

test('snoozing re-reminds with an increased emphasis baseline', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 45));
  const snoozeEvents = engine.snooze(5, at(10, 46));
  assert.deepEqual(eventTypes(snoozeEvents), ['dismissReminder', 'snoozed']);
  assert.equal(engine.getSnapshot(at(10, 46)).phase, PHASES.SNOOZED);
  assert.equal(engine.getSnapshot(at(10, 46)).dueAt, at(10, 51));

  const again = engine.tick(at(10, 51));
  assert.equal(again[0].type, 'reminder');
  assert.equal(again[0].level, 1);
  engine.snooze(10, at(10, 52));
  const third = engine.tick(at(11, 2));
  assert.equal(third[0].type, 'reminder');
  assert.equal(third[0].level, 2);
});

test('a completed break restarts a full sitting interval', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 45));
  const breakEvents = engine.startBreak(at(10, 46));
  assert.deepEqual(eventTypes(breakEvents), ['dismissReminder', 'breakStarted']);
  assert.equal(engine.getSnapshot(at(10, 47)).phase, PHASES.BREAK);
  assert.equal(engine.getSnapshot(at(10, 47)).remainingMs, 4 * MINUTE);
  assert.deepEqual(eventTypes(engine.tick(at(10, 50))), []);
  const completed = engine.tick(at(10, 51));
  assert.deepEqual(eventTypes(completed), ['breakCompleted']);
  assert.equal(engine.getSnapshot(at(10, 51)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(10, 51)).dueAt, at(11, 36));
});

test('finishing a break early does not count as completed', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 45));
  engine.startBreak(at(10, 46));
  const events = engine.finishBreak(at(10, 47));
  assert.deepEqual(eventTypes(events), ['breakEndedEarly']);
  assert.equal(engine.getSnapshot(at(10, 47)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(10, 47)).dueAt, at(11, 32));
});

test('a break clipped by lunch is not counted as complete', () => {
  const engine = makeEngine(at(11, 30), { sitMinutes: 20, standMinutes: 30 });
  engine.tick(at(11, 50));
  engine.startBreak(at(11, 51));
  const events = engine.tick(at(12, 0));
  assert.equal(eventTypes(events).includes('breakCompleted'), false);
  assert.equal(engine.getSnapshot(at(12, 0)).phase, PHASES.LUNCH);
});

test('manual pause suppresses reminders and then starts a fresh cycle', () => {
  const engine = makeEngine(at(10, 0));
  engine.pause(at(10, 30), at(10, 5));
  engine.tick(at(10, 20));
  assert.equal(engine.getSnapshot(at(10, 20)).phase, PHASES.PAUSED);
  engine.tick(at(10, 30));
  assert.equal(engine.getSnapshot(at(10, 30)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(10, 30)).dueAt, at(11, 15));
});

test('pausing while a reminder is open dismisses it', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 45));
  const events = engine.pause(at(11, 0), at(10, 46));
  assert.ok(eventTypes(events).includes('dismissReminder'));
  assert.equal(engine.getSnapshot(at(10, 46)).phase, PHASES.PAUSED);
});

test('lock/sleep freeze shifts remaining sitting time by the frozen duration', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 10));
  engine.freeze(at(10, 10));
  assert.equal(engine.getSnapshot(at(10, 15)).remainingMs, 35 * MINUTE);
  assert.equal(engine.getSnapshot(at(10, 15)).frozen, true);
  assert.deepEqual(eventTypes(engine.tick(at(10, 20))), []);

  const events = engine.unfreeze(at(10, 20));
  assert.ok(eventTypes(events).includes('resumedFromFreeze'));
  assert.equal(engine.getSnapshot(at(10, 20)).dueAt, at(10, 55));
  assert.equal(engine.getSnapshot(at(10, 20)).remainingMs, 35 * MINUTE);
  assert.deepEqual(eventTypes(engine.tick(at(10, 54))), []);
  assert.equal(engine.tick(at(10, 55))[0].type, 'reminder');
});

test('freezing an open reminder hides it and shows it again after resume', () => {
  const engine = makeEngine(at(10, 0));
  engine.tick(at(10, 45));
  const freezeEvents = engine.freeze(at(10, 46));
  assert.ok(eventTypes(freezeEvents).includes('dismissReminder'));
  assert.equal(engine.frozen, true);
  const resumeEvents = engine.unfreeze(at(10, 50));
  assert.ok(eventTypes(resumeEvents).includes('reminder'));
  const reminder = resumeEvents.find((event) => event.type === 'reminder');
  assert.equal(reminder.reason, 'resume');
  assert.equal(engine.getSnapshot(at(10, 50)).phase, PHASES.REMINDER);
});

test('a settings change restarts the cycle immediately', () => {
  const engine = makeEngine(at(10, 0));
  const settings = createDefaultSettings();
  settings.rhythm.sitMinutes = 60;
  const events = engine.reconfigure(settings, at(10, 10));
  assert.ok(eventTypes(events).includes('settingsApplied'));
  assert.equal(engine.getSnapshot(at(10, 10)).phase, PHASES.SITTING);
  assert.equal(engine.getSnapshot(at(10, 10)).dueAt, at(11, 10));
});

test('manual resume while off-hours falls back to idle', () => {
  const engine = makeEngine(at(17, 55));
  engine.pause(at(18, 30), at(17, 56));
  engine.resume(at(18, 0));
  assert.equal(engine.getSnapshot(at(18, 0)).phase, PHASES.IDLE);
});

test('snooze and break actions reject an invalid phase', () => {
  const engine = makeEngine(at(10, 0));
  assert.throws(() => engine.snooze(5, at(10, 5)), /没有待处理/);
  assert.throws(() => engine.startBreak(at(10, 5)), /没有待处理/);
  assert.throws(() => engine.finishBreak(at(10, 5)), /不在休息/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerService } = require('../src/main/scheduler');
const { createDefaultSettings } = require('../src/shared/defaults');

function at(hour, minute = 0) {
  return new Date(2026, 9, 19, hour, minute, 0, 0).getTime();
}

function makeScheduler(start, durations) {
  const settings = createDefaultSettings();
  settings.schedule = {
    workdays: [0, 1, 2, 3, 4, 5, 6],
    workStart: '00:00',
    workEnd: '23:59',
    lunchEnabled: false,
    lunchStart: '12:00',
    lunchEnd: '13:30',
  };
  settings.rhythm = { sitMinutes: 45, standMinutes: 5 };
  const store = {
    load: () => ({ settings, stats: {} }),
    save: () => {},
  };
  let now = start;
  const scheduler = new SchedulerService({
    store,
    clock: () => now,
    durations,
  });
  return {
    scheduler,
    setNow(value) {
      now = value;
    },
  };
}

function candidateSettings(scheduler) {
  return {
    displayMode: scheduler.settings.displayMode,
    autoStart: scheduler.settings.autoStart,
    soundEnabled: scheduler.settings.soundEnabled,
    boardAlwaysOnTop: scheduler.settings.boardAlwaysOnTop,
    schedule: { ...scheduler.settings.schedule },
    rhythm: { sitMinutes: 30, standMinutes: 2 },
  };
}

test('a long tick gap while a reminder is open hides and re-presents it', () => {
  const start = at(10, 0);
  const { scheduler, setNow } = makeScheduler(start, {
    sitMs: 5000,
    breakMs: 3000,
  });
  const events = [];
  scheduler.on('reminder', (payload) =>
    events.push({ type: 'reminder', reason: payload.reason }),
  );
  scheduler.on('dismissReminder', (payload) =>
    events.push({ type: 'dismissReminder', reason: payload.reason }),
  );

  setNow(start + 6000);
  scheduler._tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'reminder');
  assert.equal(scheduler.getPhase(), 'REMINDER');

  setNow(start + 6000 + 120000);
  scheduler._tick();

  assert.deepEqual(events.slice(1), [
    { type: 'dismissReminder', reason: 'frozen' },
    { type: 'reminder', reason: 'resume' },
  ]);
  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.phase, 'REMINDER');
  assert.equal(snapshot.frozen, false);
  assert.equal(snapshot.stats.today.remindersShown, 2);
});

test('test durations survive a rhythm reconfiguration', () => {
  const start = at(10, 0);
  const { scheduler } = makeScheduler(start, { sitMs: 5000, breakMs: 3000 });

  const snapshot = scheduler.updateSettings(candidateSettings(scheduler), start);

  assert.equal(snapshot.phase, 'SITTING');
  assert.equal(snapshot.dueAt, start + 5000);
  assert.equal(snapshot.remainingMs, 5000);
  assert.equal(snapshot.settings.rhythm.sitMinutes, 30);
});

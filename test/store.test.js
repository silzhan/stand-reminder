'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/main/store');
const { createDefaultSettings } = require('../src/shared/defaults');

function withTempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stand-reminder-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'store.json'), store: new JsonStore(path.join(dir, 'store.json')) };
}

test('returns defaults when no file exists', (t) => {
  const { store } = withTempStore(t);
  const data = store.load();
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.settings.displayMode, 'widget');
  assert.deepEqual(data.stats, {});
});

test('round-trips settings and statistics', (t) => {
  const { file, store } = withTempStore(t);
  const settings = createDefaultSettings();
  settings.displayMode = 'orb';
  settings.schedule.workdays = [1, 3, 5];
  settings.bounds.widget = { x: 20, y: 30, width: 320, height: 120 };
  const stats = {
    '2026-10-20': {
      sittingMs: 3000,
      remindersShown: 1,
      snoozes: 0,
      breaksStarted: 1,
      breaksCompleted: 1,
    },
  };
  store.save({ settings, stats });
  const loaded = store.load(new Date(2026, 9, 20, 15).getTime());
  assert.equal(loaded.settings.displayMode, 'orb');
  assert.deepEqual(loaded.settings.schedule.workdays, [1, 3, 5]);
  assert.deepEqual(loaded.settings.bounds.widget, {
    x: 20,
    y: 30,
    width: 320,
    height: 120,
  });
  assert.equal(loaded.stats['2026-10-20'].breaksCompleted, 1);
  assert.ok(fs.existsSync(file));
});

test('backs up corrupt JSON and recovers defaults', (t) => {
  const { dir, file, store } = withTempStore(t);
  fs.writeFileSync(file, '{ this is not json', 'utf8');
  const data = store.load();
  assert.equal(data.settings.displayMode, 'widget');
  const backups = fs.readdirSync(dir).filter((name) => name.includes('.bad-'));
  assert.equal(backups.length, 1);
});

test('normalizes bad persisted fields rather than crashing', (t) => {
  const { file, store } = withTempStore(t);
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 99,
      settings: {
        displayMode: 'invalid',
        autoStart: 'yes',
        schedule: {
          workdays: [],
          workStart: 'noon',
          workEnd: '09:00',
          lunchEnabled: true,
          lunchStart: '12:00',
          lunchEnd: '13:00',
        },
      },
      stats: { bad: {} },
    }),
    'utf8',
  );
  const data = store.load();
  assert.equal(data.settings.displayMode, 'widget');
  assert.equal(data.settings.autoStart, true);
  assert.deepEqual(data.settings.schedule.workdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(data.stats, {});
});

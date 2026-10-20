'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDefaultSettings,
  normalizeLoadedSettings,
  validateUserSettings,
} = require('../src/shared/defaults');

function validInput() {
  const settings = createDefaultSettings();
  delete settings.bounds;
  return settings;
}

test('accepts the default settings', () => {
  const result = validateUserSettings(validInput());
  assert.equal(result.ok, true);
  assert.equal(result.settings.rhythm.sitMinutes, 45);
  assert.equal(result.settings.schedule.workStart, '09:00');
});

test('accepts 00:00 and normalizes workdays', () => {
  const input = validInput();
  input.schedule.workStart = '00:00';
  input.schedule.lunchEnabled = false;
  input.schedule.workdays = [5, 1, 1, 3];
  const result = validateUserSettings(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings.schedule.workdays, [1, 3, 5]);
  assert.equal(result.settings.schedule.workStart, '00:00');
});

test('rejects an empty workday selection', () => {
  const input = validInput();
  input.schedule.workdays = [];
  const result = validateUserSettings(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /至少选择一个工作日/);
});

test('rejects reversed work hours', () => {
  const input = validInput();
  input.schedule.workStart = '18:00';
  input.schedule.workEnd = '09:00';
  const result = validateUserSettings(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /下班时间/);
});

test('rejects a lunch that leaves the work window', () => {
  const input = validInput();
  input.schedule.lunchEnd = '18:00';
  const result = validateUserSettings(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /午休/);
});

test('rejects out-of-range rhythm values and invalid types', () => {
  const input = validInput();
  input.rhythm.sitMinutes = 2;
  input.rhythm.standMinutes = 61;
  input.soundEnabled = 'yes';
  const result = validateUserSettings(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /坐姿时长/);
  assert.match(result.error, /起身时长/);
  assert.match(result.error, /开关设置/);
});

test('normalizes partial persisted settings without throwing', () => {
  const settings = normalizeLoadedSettings({
    displayMode: 'orb',
    autoStart: false,
    soundEnabled: 'nope',
    boardAlwaysOnTop: true,
    schedule: {
      workdays: [2, 3],
      workStart: '08:30',
      workEnd: '17:30',
      lunchEnabled: false,
      lunchStart: 'bad',
      lunchEnd: 'bad',
    },
    rhythm: { sitMinutes: 50, standMinutes: 999 },
    bounds: {
      widget: { x: 10.4, y: 20.6, width: 320, height: 100 },
      orb: { x: 'bad' },
    },
  });
  assert.equal(settings.displayMode, 'orb');
  assert.equal(settings.autoStart, false);
  assert.equal(settings.soundEnabled, true);
  assert.equal(settings.boardAlwaysOnTop, true);
  assert.equal(settings.schedule.workStart, '08:30');
  assert.equal(settings.schedule.lunchEnabled, false);
  assert.equal(settings.rhythm.sitMinutes, 50);
  assert.equal(settings.rhythm.standMinutes, 5);
  assert.deepEqual(settings.bounds.widget, {
    x: 10,
    y: 21,
    width: 320,
    height: 100,
  });
  assert.equal(settings.bounds.orb, undefined);
});

test('falls back to default schedule when persisted schedule is invalid', () => {
  const settings = normalizeLoadedSettings({
    schedule: {
      workdays: [],
      workStart: '10:00',
      workEnd: '09:00',
      lunchEnabled: true,
      lunchStart: '12:00',
      lunchEnd: '13:00',
    },
  });
  assert.deepEqual(settings.schedule.workdays, [1, 2, 3, 4, 5]);
  assert.equal(settings.schedule.workStart, '09:00');
});

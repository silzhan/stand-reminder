'use strict';

const PHASES = Object.freeze({
  IDLE: 'IDLE',
  LUNCH: 'LUNCH',
  SITTING: 'SITTING',
  SNOOZED: 'SNOOZED',
  REMINDER: 'REMINDER',
  BREAK: 'BREAK',
  PAUSED: 'PAUSED',
});

const DISPLAY_MODES = Object.freeze(['tray', 'widget', 'orb', 'board']);

const LIMITS = Object.freeze({
  sitMinutes: [5, 180],
  standMinutes: [1, 60],
});

const DEFAULT_SCHEDULE = Object.freeze({
  workdays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
  lunchEnabled: true,
  lunchStart: '12:00',
  lunchEnd: '13:30',
});

const DEFAULT_RHYTHM = Object.freeze({
  sitMinutes: 45,
  standMinutes: 5,
});

const DEFAULT_SETTINGS = Object.freeze({
  displayMode: 'widget',
  autoStart: true,
  soundEnabled: true,
  boardAlwaysOnTop: false,
  schedule: DEFAULT_SCHEDULE,
  rhythm: DEFAULT_RHYTHM,
  bounds: {},
});

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_RE.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function createDefaultSettings() {
  return clone(DEFAULT_SETTINGS);
}

function validateSchedule(schedule) {
  const errors = [];
  if (!isPlainObject(schedule)) {
    return { errors: ['时间设置无效'], value: null };
  }

  const workdays = Array.isArray(schedule.workdays)
    ? [...new Set(schedule.workdays)]
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .sort((a, b) => a - b)
    : [];

  if (workdays.length === 0) errors.push('至少选择一个工作日');

  const workStart = Number.isInteger(timeToMinutes(schedule.workStart))
    ? schedule.workStart
    : null;
  const workEnd = Number.isInteger(timeToMinutes(schedule.workEnd))
    ? schedule.workEnd
    : null;
  if (!workStart || !workEnd) errors.push('工作开始或结束时间格式无效');
  if (workStart && workEnd && timeToMinutes(workStart) >= timeToMinutes(workEnd)) {
    errors.push('下班时间必须晚于上班时间');
  }

  const lunchEnabled = Boolean(schedule.lunchEnabled);
  let lunchStart = null;
  let lunchEnd = null;
  if (lunchEnabled) {
    lunchStart = Number.isInteger(timeToMinutes(schedule.lunchStart))
      ? schedule.lunchStart
      : null;
    lunchEnd = Number.isInteger(timeToMinutes(schedule.lunchEnd))
      ? schedule.lunchEnd
      : null;
    if (!lunchStart || !lunchEnd) {
      errors.push('午休时间格式无效');
    } else {
      const ls = timeToMinutes(lunchStart);
      const le = timeToMinutes(lunchEnd);
      if (ls >= le) errors.push('午休结束时间必须晚于开始时间');
      if (workStart && workEnd) {
        const ws = timeToMinutes(workStart);
        const we = timeToMinutes(workEnd);
        if (!(ws < ls && ls < le && le < we)) {
          errors.push('午休必须完整位于工作时段内');
        }
      }
    }
  }

  return {
    errors,
    value: {
      workdays,
      workStart: workStart || DEFAULT_SCHEDULE.workStart,
      workEnd: workEnd || DEFAULT_SCHEDULE.workEnd,
      lunchEnabled,
      lunchStart: lunchStart || DEFAULT_SCHEDULE.lunchStart,
      lunchEnd: lunchEnd || DEFAULT_SCHEDULE.lunchEnd,
    },
  };
}

function normalizeRhythm(rhythm) {
  const sit = Number(rhythm && rhythm.sitMinutes);
  const stand = Number(rhythm && rhythm.standMinutes);
  return {
    sitMinutes:
      Number.isInteger(sit) && sit >= LIMITS.sitMinutes[0] && sit <= LIMITS.sitMinutes[1]
        ? sit
        : DEFAULT_RHYTHM.sitMinutes,
    standMinutes:
      Number.isInteger(stand) &&
      stand >= LIMITS.standMinutes[0] &&
      stand <= LIMITS.standMinutes[1]
        ? stand
        : DEFAULT_RHYTHM.standMinutes,
  };
}

function normalizeBounds(raw) {
  if (!isPlainObject(raw)) return {};
  const bounds = {};
  for (const key of ['widget', 'orb', 'board', 'reminder']) {
    const item = raw[key];
    if (!isPlainObject(item)) continue;
    if (!['x', 'y', 'width', 'height'].every((prop) => Number.isFinite(item[prop]))) {
      continue;
    }
    bounds[key] = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: Math.max(1, Math.round(item.width)),
      height: Math.max(1, Math.round(item.height)),
    };
  }
  return bounds;
}

function normalizeLoadedSettings(raw) {
  const settings = createDefaultSettings();
  if (!isPlainObject(raw)) return settings;

  if (DISPLAY_MODES.includes(raw.displayMode)) settings.displayMode = raw.displayMode;
  if (typeof raw.autoStart === 'boolean') settings.autoStart = raw.autoStart;
  if (typeof raw.soundEnabled === 'boolean') settings.soundEnabled = raw.soundEnabled;
  if (typeof raw.boardAlwaysOnTop === 'boolean') {
    settings.boardAlwaysOnTop = raw.boardAlwaysOnTop;
  }

  const scheduleResult = validateSchedule(raw.schedule);
  if (scheduleResult.errors.length === 0) settings.schedule = scheduleResult.value;
  settings.rhythm = normalizeRhythm(raw.rhythm);
  settings.bounds = normalizeBounds(raw.bounds);
  return settings;
}

function validateUserSettings(input) {
  if (!isPlainObject(input)) {
    return { ok: false, error: '设置数据无效' };
  }

  const errors = [];
  const displayMode = DISPLAY_MODES.includes(input.displayMode)
    ? input.displayMode
    : null;
  if (!displayMode) errors.push('显示模式无效');

  for (const key of ['autoStart', 'soundEnabled', 'boardAlwaysOnTop']) {
    if (typeof input[key] !== 'boolean') errors.push('开关设置无效');
  }

  const scheduleResult = validateSchedule(input.schedule);
  errors.push(...scheduleResult.errors);

  const sitMinutes = Number(input.rhythm && input.rhythm.sitMinutes);
  const standMinutes = Number(input.rhythm && input.rhythm.standMinutes);
  if (
    !Number.isInteger(sitMinutes) ||
    sitMinutes < LIMITS.sitMinutes[0] ||
    sitMinutes > LIMITS.sitMinutes[1]
  ) {
    errors.push(`坐姿时长需在 ${LIMITS.sitMinutes[0]}–${LIMITS.sitMinutes[1]} 分钟之间`);
  }
  if (
    !Number.isInteger(standMinutes) ||
    standMinutes < LIMITS.standMinutes[0] ||
    standMinutes > LIMITS.standMinutes[1]
  ) {
    errors.push(
      `起身时长需在 ${LIMITS.standMinutes[0]}–${LIMITS.standMinutes[1]} 分钟之间`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, error: [...new Set(errors)].join('；') };
  }

  return {
    ok: true,
    settings: {
      displayMode,
      autoStart: input.autoStart,
      soundEnabled: input.soundEnabled,
      boardAlwaysOnTop: input.boardAlwaysOnTop,
      schedule: scheduleResult.value,
      rhythm: { sitMinutes, standMinutes },
    },
  };
}

module.exports = {
  DEFAULT_RHYTHM,
  DEFAULT_SCHEDULE,
  DEFAULT_SETTINGS,
  DISPLAY_MODES,
  LIMITS,
  PHASES,
  clone,
  createDefaultSettings,
  isPlainObject,
  normalizeBounds,
  normalizeLoadedSettings,
  timeToMinutes,
  validateSchedule,
  validateUserSettings,
};

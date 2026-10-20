'use strict';

const { dayKey, startOfLocalDay } = require('./schedule');

const RETENTION_DAYS = 30;
const COUNTER_FIELDS = [
  'remindersShown',
  'snoozes',
  'breaksStarted',
  'breaksCompleted',
];

function emptyDay() {
  return {
    sittingMs: 0,
    remindersShown: 0,
    snoozes: 0,
    breaksStarted: 0,
    breaksCompleted: 0,
  };
}

function ensureDay(stats, key) {
  if (!stats[key]) stats[key] = emptyDay();
  return stats[key];
}

function normalizeStats(raw, now = Date.now()) {
  const stats = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') {
        continue;
      }
      const day = emptyDay();
      const sitting = Number(value.sittingMs);
      day.sittingMs = Number.isFinite(sitting) && sitting > 0 ? Math.floor(sitting) : 0;
      for (const field of COUNTER_FIELDS) {
        const count = Number(value[field]);
        day[field] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      }
      stats[key] = day;
    }
  }
  pruneStats(stats, now);
  return stats;
}

function pruneStats(stats, now = Date.now(), retentionDays = RETENTION_DAYS) {
  const cutoff = new Date(startOfLocalDay(now));
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1));
  const cutoffKey = dayKey(cutoff.getTime());
  for (const key of Object.keys(stats)) {
    if (key < cutoffKey) delete stats[key];
  }
  return stats;
}

function addSittingMs(stats, now, deltaMs) {
  const delta = Math.max(0, Math.floor(Number(deltaMs) || 0));
  if (delta === 0) return null;
  const key = dayKey(now);
  const day = ensureDay(stats, key);
  day.sittingMs += delta;
  return key;
}

function increment(stats, now, field, amount = 1) {
  if (!COUNTER_FIELDS.includes(field)) {
    throw new Error(`Unknown statistic field: ${field}`);
  }
  const key = dayKey(now);
  const day = ensureDay(stats, key);
  day[field] += Math.max(0, Math.floor(Number(amount) || 0));
  return key;
}

function mondayOfWeek(now) {
  const date = new Date(startOfLocalDay(now));
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function buildStatsView(stats, now = Date.now()) {
  const todayKey = dayKey(now);
  const today = stats[todayKey] || emptyDay();
  const monday = mondayOfWeek(now);
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const days = labels.map((label, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const key = dayKey(date.getTime());
    const value = stats[key] || emptyDay();
    return {
      key,
      label,
      shortDate: `${date.getMonth() + 1}/${date.getDate()}`,
      isToday: key === todayKey,
      isFuture: key > todayKey,
      sittingMs: value.sittingMs,
      remindersShown: value.remindersShown,
      snoozes: value.snoozes,
      breaksStarted: value.breaksStarted,
      breaksCompleted: value.breaksCompleted,
    };
  });

  const totals = days.reduce(
    (result, day) => {
      result.sittingMs += day.sittingMs;
      result.remindersShown += day.remindersShown;
      result.snoozes += day.snoozes;
      result.breaksStarted += day.breaksStarted;
      result.breaksCompleted += day.breaksCompleted;
      return result;
    },
    {
      sittingMs: 0,
      remindersShown: 0,
      snoozes: 0,
      breaksStarted: 0,
      breaksCompleted: 0,
    },
  );
  totals.completionRate =
    totals.breaksStarted > 0
      ? Math.round((totals.breaksCompleted / totals.breaksStarted) * 100)
      : 0;

  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return {
    today: {
      key: todayKey,
      ...today,
    },
    week: {
      days,
      totals,
      startKey: dayKey(monday.getTime()),
      endKey: dayKey(weekEnd.getTime()),
    },
    retentionDays: RETENTION_DAYS,
  };
}

module.exports = {
  COUNTER_FIELDS,
  RETENTION_DAYS,
  addSittingMs,
  buildStatsView,
  emptyDay,
  ensureDay,
  increment,
  normalizeStats,
  pruneStats,
};

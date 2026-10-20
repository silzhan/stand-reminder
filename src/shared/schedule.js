'use strict';

const { timeToMinutes } = require('./defaults');

const MINUTE_MS = 60 * 1000;

function atTime(timestamp, hhmm) {
  const minutes = timeToMinutes(hhmm);
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setMinutes(minutes);
  return date.getTime();
}

function dayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function findNextWorkStart(timestamp, schedule) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(timestamp);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(0, 0, 0, 0);
    if (!schedule.workdays.includes(candidate.getDay())) continue;
    candidate.setMinutes(timeToMinutes(schedule.workStart));
    if (candidate.getTime() > timestamp) return candidate.getTime();
  }
  return null;
}

function resolveSchedule(timestamp, schedule) {
  const date = new Date(timestamp);
  const todayIsWorkday = schedule.workdays.includes(date.getDay());
  const workStartAt = atTime(timestamp, schedule.workStart);
  const workEndAt = atTime(timestamp, schedule.workEnd);
  const lunchStartAt = schedule.lunchEnabled
    ? atTime(timestamp, schedule.lunchStart)
    : null;
  const lunchEndAt = schedule.lunchEnabled
    ? atTime(timestamp, schedule.lunchEnd)
    : null;

  if (!todayIsWorkday) {
    return {
      kind: 'off',
      reason: 'non-workday',
      workStartAt,
      workEndAt,
      lunchStartAt,
      lunchEndAt,
      activeUntilAt: null,
      nextStartAt: findNextWorkStart(timestamp, schedule),
    };
  }

  if (timestamp < workStartAt) {
    return {
      kind: 'off',
      reason: 'before-work',
      workStartAt,
      workEndAt,
      lunchStartAt,
      lunchEndAt,
      activeUntilAt: null,
      nextStartAt: workStartAt,
    };
  }

  if (timestamp >= workEndAt) {
    return {
      kind: 'off',
      reason: 'after-work',
      workStartAt,
      workEndAt,
      lunchStartAt,
      lunchEndAt,
      activeUntilAt: null,
      nextStartAt: findNextWorkStart(timestamp, schedule),
    };
  }

  if (
    schedule.lunchEnabled &&
    timestamp >= lunchStartAt &&
    timestamp < lunchEndAt
  ) {
    return {
      kind: 'lunch',
      reason: 'lunch',
      workStartAt,
      workEndAt,
      lunchStartAt,
      lunchEndAt,
      activeUntilAt: null,
      nextStartAt: lunchEndAt,
    };
  }

  const activeUntilAt =
    schedule.lunchEnabled && timestamp < lunchStartAt ? lunchStartAt : workEndAt;
  return {
    kind: 'active',
    reason:
      schedule.lunchEnabled && timestamp < lunchStartAt ? 'morning' : 'working',
    workStartAt,
    workEndAt,
    lunchStartAt,
    lunchEndAt,
    activeUntilAt,
    nextStartAt: null,
  };
}

function pauseUntilFor(timestamp, schedule, mode) {
  if (mode === 'today') {
    const view = resolveSchedule(timestamp, schedule);
    if (view.kind !== 'off') return view.workEndAt;
    return view.nextStartAt;
  }
  const minutes = Number(mode);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return timestamp + minutes * MINUTE_MS;
}

function describeNextStart(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
  if (sameDay) return `今天 ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${time}`;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${weekdays[date.getDay()]} ${time}`;
}

module.exports = {
  MINUTE_MS,
  atTime,
  dayKey,
  describeNextStart,
  findNextWorkStart,
  pauseUntilFor,
  resolveSchedule,
  startOfLocalDay,
};

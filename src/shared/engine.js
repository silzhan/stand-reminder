'use strict';

const { clone, PHASES } = require('./defaults');
const { resolveSchedule } = require('./schedule');

const MINUTE_MS = 60 * 1000;
const ESCALATE_AFTER_MS = 60 * 1000;
const MAX_ESCALATION = 3;

function reminderEvent(engine, reason, now) {
  return {
    type: 'reminder',
    reason,
    reminderId: engine.reminderId,
    level: engine.escalationLevel,
    cycleSnoozes: engine.cycleSnoozes,
    sittingElapsedMs: engine.sittingStartedAt
      ? Math.max(0, now - engine.sittingStartedAt)
      : 0,
  };
}

class ReminderEngine {
  constructor({ settings, now = Date.now(), durations = null }) {
    this.schedule = clone(settings.schedule);
    this.durations = durations;
    this.sitMs = durations && durations.sitMs
      ? durations.sitMs
      : settings.rhythm.sitMinutes * MINUTE_MS;
    this.breakMs = durations && durations.breakMs
      ? durations.breakMs
      : settings.rhythm.standMinutes * MINUTE_MS;

    this.phase = null;
    this.phaseStartedAt = now;
    this.sittingStartedAt = null;
    this.dueAt = null;
    this.breakStartedAt = null;
    this.breakEndsAt = null;
    this.pausedUntil = null;
    this.phaseTotalMs = 0;
    this.reminderShownAt = null;
    this.baseEscalation = 0;
    this.escalationLevel = 0;
    this.cycleSnoozes = 0;
    this.reminderSerial = 0;
    this.reminderId = null;
    this.frozen = false;
    this.freezeStartedAt = null;
    this.lastTickAt = now;

    const view = resolveSchedule(now, this.schedule);
    if (view.kind === 'active') {
      this._startSitting(now, []);
    } else if (view.kind === 'lunch') {
      this._enterLunch(now, []);
    } else {
      this._enterIdle(now, []);
    }
  }

  _dismiss(events, reason) {
    if (this.phase === PHASES.REMINDER) {
      events.push({
        type: 'dismissReminder',
        reason,
        reminderId: this.reminderId,
      });
    }
  }

  _clearReminderState() {
    this.reminderShownAt = null;
    this.baseEscalation = 0;
    this.escalationLevel = 0;
    this.reminderId = null;
  }

  _startSitting(now, events) {
    this._dismiss(events, 'sitting-started');
    this.phase = PHASES.SITTING;
    this.phaseStartedAt = now;
    this.sittingStartedAt = now;
    this.dueAt = now + this.sitMs;
    this.breakStartedAt = null;
    this.breakEndsAt = null;
    this.pausedUntil = null;
    this.phaseTotalMs = this.sitMs;
    this.cycleSnoozes = 0;
    this._clearReminderState();
  }

  _enterReminder(now, events, reason = 'due') {
    this.phase = PHASES.REMINDER;
    this.phaseStartedAt = now;
    this.reminderShownAt = now;
    this.reminderSerial += 1;
    this.reminderId = `${this.sittingStartedAt || now}-${this.reminderSerial}`;
    this.baseEscalation = Math.min(2, this.cycleSnoozes);
    this.escalationLevel = this.baseEscalation;
    this.phaseTotalMs = 1;
    events.push(reminderEvent(this, reason, now));
  }

  _enterBreak(now, events) {
    this._dismiss(events, 'break-started');
    this.phase = PHASES.BREAK;
    this.phaseStartedAt = now;
    this.breakStartedAt = now;
    this.breakEndsAt = now + this.breakMs;
    this.dueAt = null;
    this.phaseTotalMs = this.breakMs;
    this.cycleSnoozes = 0;
    this._clearReminderState();
    events.push({ type: 'breakStarted', breakEndsAt: this.breakEndsAt });
  }

  _completeBreak(now, events) {
    events.push({ type: 'breakCompleted', at: now });
    this._startSitting(now, events);
  }

  _enterIdle(now, events) {
    this._dismiss(events, 'off-hours');
    this.phase = PHASES.IDLE;
    this.phaseStartedAt = now;
    this.sittingStartedAt = null;
    this.dueAt = null;
    this.breakStartedAt = null;
    this.breakEndsAt = null;
    this.pausedUntil = null;
    this.phaseTotalMs = 0;
    this.cycleSnoozes = 0;
    this._clearReminderState();
  }

  _enterLunch(now, events) {
    this._dismiss(events, 'lunch');
    this.phase = PHASES.LUNCH;
    this.phaseStartedAt = now;
    this.sittingStartedAt = null;
    this.dueAt = null;
    this.breakStartedAt = null;
    this.breakEndsAt = null;
    this.pausedUntil = null;
    this.phaseTotalMs = 0;
    this.cycleSnoozes = 0;
    this._clearReminderState();
  }

  _enterSchedule(now, view, events) {
    if (view.kind === 'active') {
      this._startSitting(now, events);
    } else if (view.kind === 'lunch') {
      this._enterLunch(now, events);
    } else {
      this._enterIdle(now, events);
    }
  }

  _resetToSchedule(now, events) {
    this.pausedUntil = null;
    const view = resolveSchedule(now, this.schedule);
    this._enterSchedule(now, view, events);
  }

  _updateEscalation(now, events) {
    if (this.reminderShownAt === null) return;
    const elapsed = now - this.reminderShownAt;
    const timeLevel =
      elapsed >= ESCALATE_AFTER_MS * 2
        ? 2
        : elapsed >= ESCALATE_AFTER_MS
          ? 1
          : 0;
    const nextLevel = Math.min(MAX_ESCALATION, this.baseEscalation + timeLevel);
    if (nextLevel > this.escalationLevel) {
      this.escalationLevel = nextLevel;
      events.push({
        type: 'reminderEscalated',
        reminderId: this.reminderId,
        level: nextLevel,
        cycleSnoozes: this.cycleSnoozes,
      });
    }
  }

  tick(now = Date.now()) {
    const events = [];
    this.lastTickAt = now;

    if (this.frozen) return events;

    const view = resolveSchedule(now, this.schedule);

    if (this.phase === PHASES.PAUSED) {
      if (this.pausedUntil !== null && now < this.pausedUntil) return events;
      this.pausedUntil = null;
      this._enterSchedule(now, view, events);
      return events;
    }

    if (view.kind === 'off') {
      if (this.phase !== PHASES.IDLE) this._enterIdle(now, events);
      return events;
    }

    if (view.kind === 'lunch') {
      if (this.phase !== PHASES.LUNCH) this._enterLunch(now, events);
      return events;
    }

    if (this.phase === PHASES.IDLE || this.phase === PHASES.LUNCH) {
      this._startSitting(now, events);
      return events;
    }

    if (this.phase === PHASES.SITTING || this.phase === PHASES.SNOOZED) {
      if (this.dueAt !== null && now >= this.dueAt) {
        this._enterReminder(now, events, 'due');
      }
      return events;
    }

    if (this.phase === PHASES.REMINDER) {
      this._updateEscalation(now, events);
      return events;
    }

    if (this.phase === PHASES.BREAK) {
      if (this.breakEndsAt !== null && now >= this.breakEndsAt) {
        this._completeBreak(now, events);
      }
      return events;
    }

    return events;
  }

  snooze(minutes, now = Date.now()) {
    if (this.phase !== PHASES.REMINDER) {
      throw new Error('现在没有待处理的起身提醒');
    }
    const amount = Number(minutes);
    if (!Number.isInteger(amount) || amount < 1 || amount > 60) {
      throw new Error('延后时长无效');
    }
    const events = [];
    this._dismiss(events, 'snoozed');
    this.cycleSnoozes += 1;
    this.phase = PHASES.SNOOZED;
    this.phaseStartedAt = now;
    this.dueAt = now + amount * MINUTE_MS;
    this.phaseTotalMs = amount * MINUTE_MS;
    this._clearReminderState();
    events.push({ type: 'snoozed', minutes: amount });
    return events;
  }

  startBreak(now = Date.now()) {
    if (this.phase !== PHASES.REMINDER) {
      throw new Error('现在没有待处理的起身提醒');
    }
    const events = [];
    this._enterBreak(now, events);
    return events;
  }

  finishBreak(now = Date.now()) {
    if (this.phase !== PHASES.BREAK) {
      throw new Error('当前不在休息阶段');
    }
    const events = [{ type: 'breakEndedEarly', at: now }];
    this._startSitting(now, events);
    return events;
  }

  pause(until, now = Date.now()) {
    const end = Number(until);
    if (!Number.isFinite(end) || end <= now) {
      throw new Error('暂停的结束时间无效');
    }
    const events = [];
    this._dismiss(events, 'paused');
    this.phase = PHASES.PAUSED;
    this.phaseStartedAt = now;
    this.pausedUntil = end;
    this.phaseTotalMs = end - now;
    this.sittingStartedAt = null;
    this.dueAt = null;
    this.breakStartedAt = null;
    this.breakEndsAt = null;
    this.cycleSnoozes = 0;
    this._clearReminderState();
    events.push({ type: 'paused', until: end });
    return events;
  }

  resume(now = Date.now()) {
    if (this.phase !== PHASES.PAUSED) return [];
    const events = [];
    this.pausedUntil = null;
    const view = resolveSchedule(now, this.schedule);
    this._enterSchedule(now, view, events);
    events.push({ type: 'resumed' });
    return events;
  }

  reconfigure(settings, now = Date.now()) {
    this.schedule = clone(settings.schedule);
    this.sitMs = this.durations && this.durations.sitMs
      ? this.durations.sitMs
      : settings.rhythm.sitMinutes * MINUTE_MS;
    this.breakMs = this.durations && this.durations.breakMs
      ? this.durations.breakMs
      : settings.rhythm.standMinutes * MINUTE_MS;
    const events = [{ type: 'settingsApplied' }];
    this._resetToSchedule(now, events);
    return events;
  }

  freeze(now = Date.now()) {
    if (this.frozen) return [];
    const events = [];
    this.frozen = true;
    this.freezeStartedAt = now;
    this._dismiss(events, 'frozen');
    events.push({ type: 'frozen' });
    return events;
  }

  unfreeze(now = Date.now()) {
    if (!this.frozen) return [];
    const frozenDuration = Math.max(0, now - (this.freezeStartedAt || now));
    if (this.dueAt !== null) this.dueAt += frozenDuration;
    if (this.breakEndsAt !== null) this.breakEndsAt += frozenDuration;
    if (this.pausedUntil !== null) this.pausedUntil += frozenDuration;
    this.frozen = false;
    this.freezeStartedAt = null;
    this.lastTickAt = now;

    const events = [{ type: 'resumedFromFreeze', frozenDuration }];
    if (this.phase === PHASES.REMINDER) {
      this.reminderShownAt = now;
      this.escalationLevel = this.baseEscalation;
      const view = resolveSchedule(now, this.schedule);
      if (view.kind === 'active') {
        events.push(reminderEvent(this, 'resume', now));
      }
    }
    return events;
  }

  isCountingSitting(now = Date.now()) {
    if (this.frozen) return false;
    if (
      ![PHASES.SITTING, PHASES.SNOOZED, PHASES.REMINDER].includes(this.phase)
    ) {
      return false;
    }
    return resolveSchedule(now, this.schedule).kind === 'active';
  }

  getSnapshot(now = Date.now()) {
    const effectiveNow = this.frozen ? this.freezeStartedAt : now;
    const view = resolveSchedule(now, this.schedule);
    let remainingMs = 0;

    if (this.phase === PHASES.SITTING || this.phase === PHASES.SNOOZED) {
      remainingMs = Math.max(0, (this.dueAt || 0) - effectiveNow);
    } else if (this.phase === PHASES.BREAK) {
      remainingMs = Math.max(0, (this.breakEndsAt || 0) - effectiveNow);
    } else if (this.phase === PHASES.PAUSED) {
      remainingMs = Math.max(0, (this.pausedUntil || 0) - effectiveNow);
    } else if (this.phase === PHASES.LUNCH) {
      remainingMs = Math.max(0, (view.lunchEndAt || 0) - now);
    } else if (this.phase === PHASES.IDLE) {
      remainingMs = Math.max(0, (view.nextStartAt || 0) - now);
    }

    const sittingElapsedMs =
      this.sittingStartedAt &&
      [PHASES.SITTING, PHASES.SNOOZED, PHASES.REMINDER].includes(this.phase)
        ? Math.max(0, effectiveNow - this.sittingStartedAt)
        : 0;

    return {
      phase: this.phase,
      frozen: this.frozen,
      now,
      phaseStartedAt: this.phaseStartedAt,
      dueAt: this.dueAt,
      breakStartedAt: this.breakStartedAt,
      breakEndsAt: this.breakEndsAt,
      pausedUntil: this.pausedUntil,
      remainingMs,
      phaseTotalMs: this.phaseTotalMs,
      sittingElapsedMs,
      cycleSnoozes: this.cycleSnoozes,
      escalationLevel: this.escalationLevel,
      scheduleKind: view.kind,
      scheduleReason: view.reason,
      nextStartAt: view.nextStartAt,
      activeUntilAt: view.activeUntilAt,
      workStartAt: view.workStartAt,
      workEndAt: view.workEndAt,
      lunchStartAt: view.lunchStartAt,
      lunchEndAt: view.lunchEndAt,
      sitMs: this.sitMs,
      breakMs: this.breakMs,
      countingSitting: this.isCountingSitting(now),
    };
  }
}

module.exports = {
  ESCALATE_AFTER_MS,
  MAX_ESCALATION,
  ReminderEngine,
};

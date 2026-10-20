'use strict';

const { EventEmitter } = require('node:events');
const {
  clone,
  validateUserSettings,
} = require('../shared/defaults');
const { ReminderEngine } = require('../shared/engine');
const {
  DISCLAIMER,
  SHORT_DISCLAIMER,
  pickTip,
} = require('../shared/health-tips');
const {
  addSittingMs,
  buildStatsView,
  increment,
  pruneStats,
} = require('../shared/stats');
const {
  dayKey,
  pauseUntilFor,
} = require('../shared/schedule');

const TICK_MS = 1000;
const SAVE_INTERVAL_MS = 5000;
const MAX_ACCRUAL_STEP_MS = 5000;
const MAX_TICK_GAP_MS = 90000;

function publicSettings(settings) {
  return {
    displayMode: settings.displayMode,
    autoStart: settings.autoStart,
    soundEnabled: settings.soundEnabled,
    boardAlwaysOnTop: settings.boardAlwaysOnTop,
    schedule: clone(settings.schedule),
    rhythm: clone(settings.rhythm),
  };
}

function uniqueEvents(events) {
  const dismissed = new Set(
    events
      .filter((event) => event.type === 'dismissReminder')
      .map((event) => event.reminderId),
  );
  return events.filter(
    (event) =>
      !(event.type === 'reminder' && dismissed.has(event.reminderId)),
  );
}

class SchedulerService extends EventEmitter {
  constructor({ store, clock = Date.now, tickMs = TICK_MS, meta = {}, durations = null }) {
    super();
    this.store = store;
    this.clock = clock;
    this.tickMs = tickMs;
    this.meta = meta;
    this.durations = durations;
    this.interval = null;
    this.statsDirty = false;
    this.lastPersistAt = 0;
    this.lastPrunedDay = null;
    this.freezeReasons = new Set();
    this.activeReminder = null;
    this.tipSequence = 0;
    this.lastTickAt = this.clock();

    const loaded = this.store.load(this.lastTickAt);
    this.settings = loaded.settings;
    this.stats = loaded.stats;
    this.engine = new ReminderEngine({
      settings: this.settings,
      now: this.lastTickAt,
      durations: this.durations,
    });
    this.lastAccrualAt = this.lastTickAt;
    this.lastPersistAt = this.lastTickAt;
    this.lastPrunedDay = dayKey(this.lastTickAt);
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this._tick(), this.tickMs);
    this.emitSnapshot();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  shutdown(now = this.clock()) {
    this.stop();
    this._accrueUntil(now);
    this._persist();
  }

  _markStatsDirty() {
    this.statsDirty = true;
  }

  _persist() {
    try {
      this.store.save({ settings: this.settings, stats: this.stats });
      this.statsDirty = false;
      this.lastPersistAt = this.clock();
    } catch (error) {
      this.emit('persistError', error);
    }
  }

  _maybePersist(now) {
    if (!this.statsDirty) return;
    if (now - this.lastPersistAt >= SAVE_INTERVAL_MS) this._persist();
  }

  _maybePrune(now) {
    const key = dayKey(now);
    if (key === this.lastPrunedDay) return;
    pruneStats(this.stats, now);
    this.lastPrunedDay = key;
    this._markStatsDirty();
  }

  _accrueUntil(now) {
    const previous = this.lastAccrualAt;
    this.lastAccrualAt = now;
    if (!this.engine.isCountingSitting(now)) return;
    const delta = now - previous;
    if (delta <= 0) return;
    const capped = Math.min(delta, MAX_ACCRUAL_STEP_MS);
    if (capped <= 0) return;
    addSittingMs(this.stats, now, capped);
    this._markStatsDirty();
  }

  _tick() {
    const now = this.clock();
    const previous = this.lastTickAt;
    this.lastTickAt = now;

    if (!this.engine.frozen && now - previous > MAX_TICK_GAP_MS) {
      this._accrueUntil(previous);
      const gapEvents = [
        ...this.engine.freeze(previous),
        ...this.engine.unfreeze(now),
      ];
      this.lastAccrualAt = now;
      // Process the freeze/unfreeze sequence in order so an active reminder is
      // hidden and re-presented after the missed sleep gap.
      this._processEvents(gapEvents, now);
    }

    this._accrueUntil(now);
    const events = this.engine.tick(now);
    this._processEvents(events, now);
    this._maybePrune(now);
    this._maybePersist(now);
    this.emitSnapshot(now);
  }

  _reminderPayload(event, now) {
    if (
      !this.activeReminder ||
      this.activeReminder.reminderId !== event.reminderId
    ) {
      this.activeReminder = {
        reminderId: event.reminderId,
        tip: pickTip(this.tipSequence),
        disclaimer: SHORT_DISCLAIMER,
        sittingElapsedMs: event.sittingElapsedMs || 0,
      };
      this.tipSequence += 1;
    }
    this.activeReminder.level = event.level;
    if (typeof event.sittingElapsedMs === 'number') {
      this.activeReminder.sittingElapsedMs = event.sittingElapsedMs;
    }
    return {
      ...this.activeReminder,
      reason: event.reason || 'due',
      level: event.level,
      cycleSnoozes: event.cycleSnoozes,
      sitMinutes: this.settings.rhythm.sitMinutes,
      standMinutes: this.settings.rhythm.standMinutes,
      soundEnabled: this.settings.soundEnabled,
      timestamp: now,
    };
  }

  _processEvents(events, now) {
    for (const event of events) {
      if (event.type === 'reminder') {
        increment(this.stats, now, 'remindersShown');
        this._markStatsDirty();
        this.emit('reminder', this._reminderPayload(event, now));
        this._persist();
      } else if (event.type === 'reminderEscalated') {
        if (!this.activeReminder) {
          this.activeReminder = {
            reminderId: event.reminderId,
            tip: pickTip(this.tipSequence++),
            disclaimer: SHORT_DISCLAIMER,
            sittingElapsedMs: 0,
          };
        }
        this.activeReminder.level = event.level;
        this.emit('reminderEscalated', {
          ...this.activeReminder,
          level: event.level,
          cycleSnoozes: event.cycleSnoozes,
          sitMinutes: this.settings.rhythm.sitMinutes,
          standMinutes: this.settings.rhythm.standMinutes,
          soundEnabled: this.settings.soundEnabled,
          timestamp: now,
        });
      } else if (event.type === 'dismissReminder') {
        this.activeReminder = null;
        this.emit('dismissReminder', { reason: event.reason });
      } else if (event.type === 'snoozed') {
        increment(this.stats, now, 'snoozes');
        this._markStatsDirty();
        this._persist();
      } else if (event.type === 'breakStarted') {
        increment(this.stats, now, 'breaksStarted');
        this._markStatsDirty();
        this._persist();
      } else if (event.type === 'breakCompleted') {
        increment(this.stats, now, 'breaksCompleted');
        this._markStatsDirty();
        this._persist();
      }
    }
  }

  dispatch(action, now = this.clock()) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw new Error('无效的操作');
    }
    this._accrueUntil(now);
    this.lastTickAt = now;
    let events = [];

    if (action.type === 'snooze') {
      events = this.engine.snooze(action.minutes, now);
    } else if (action.type === 'startBreak') {
      events = this.engine.startBreak(now);
    } else if (action.type === 'finishBreak') {
      events = this.engine.finishBreak(now);
    } else if (action.type === 'pause') {
      const until = pauseUntilFor(now, this.settings.schedule, action.mode);
      if (!until) throw new Error('暂停时长无效');
      events = this.engine.pause(until, now);
    } else if (action.type === 'resume') {
      events = this.engine.resume(now);
    } else {
      throw new Error('不支持的操作');
    }

    this._processEvents(events, now);
    this._accrueUntil(now);
    this._maybePersist(now);
    this.emitSnapshot(now);
    return this.getSnapshot(now);
  }

  updateSettings(candidate, now = this.clock()) {
    const result = validateUserSettings(candidate);
    if (!result.ok) throw new Error(result.error);

    const previous = this.settings;
    const next = {
      ...result.settings,
      bounds: clone(previous.bounds || {}),
    };
    const scheduleChanged =
      JSON.stringify(previous.schedule) !== JSON.stringify(next.schedule);
    const rhythmChanged =
      JSON.stringify(previous.rhythm) !== JSON.stringify(next.rhythm);

    this.settings = next;
    if (scheduleChanged || rhythmChanged) {
      const events = this.engine.reconfigure(next, now);
      this.lastAccrualAt = now;
      this._processEvents(events, now);
    }
    this._persist();
    this.emit('settingsChanged', {
      previous: publicSettings(previous),
      current: publicSettings(next),
      scheduleChanged,
      rhythmChanged,
    });
    this.emitSnapshot(now);
    return this.getSnapshot(now);
  }

  setBounds(mode, bounds) {
    if (!['widget', 'orb', 'board', 'reminder'].includes(mode)) return;
    if (
      !bounds ||
      !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))
    ) {
      return;
    }
    this.settings.bounds = {
      ...(this.settings.bounds || {}),
      [mode]: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      },
    };
    this._persist();
  }

  clearStats(now = this.clock()) {
    this.stats = {};
    this.statsDirty = true;
    this._persist();
    this.emitSnapshot(now);
    return this.getSnapshot(now);
  }

  setFrozen(reason, frozen, now = this.clock()) {
    const activeReasons = this.freezeReasons;
    if (frozen) {
      if (activeReasons.has(reason)) return this.getSnapshot(now);
      activeReasons.add(reason);
      if (activeReasons.size === 1) {
        this._accrueUntil(now);
        const events = this.engine.freeze(now);
        this.lastAccrualAt = now;
        this._processEvents(events, now);
        this._persist();
        this.emitSnapshot(now);
      }
      return this.getSnapshot(now);
    }

    if (!activeReasons.has(reason)) return this.getSnapshot(now);
    activeReasons.delete(reason);
    if (activeReasons.size === 0) {
      const unfreezeEvents = this.engine.unfreeze(now);
      const tickEvents = this.engine.tick(now);
      this.lastAccrualAt = now;
      this._processEvents(uniqueEvents([...unfreezeEvents, ...tickEvents]), now);
      this._persist();
      this.emitSnapshot(now);
    }
    return this.getSnapshot(now);
  }

  getSnapshot(now = this.clock()) {
    const snapshot = this.engine.getSnapshot(now);
    return {
      ...snapshot,
      settings: publicSettings(this.settings),
      stats: buildStatsView(this.stats, now),
      meta: clone(this.meta),
      suggestion: pickTip(this.tipSequence + Math.floor(now / 3600000)),
      disclaimer: DISCLAIMER,
      shortDisclaimer: SHORT_DISCLAIMER,
      snoozeOptions: [5, 10],
    };
  }

  emitSnapshot(now = this.clock()) {
    this.emit('snapshot', this.getSnapshot(now));
  }

  getAutostartState() {
    return this.settings.autoStart;
  }

  isFrozen() {
    return this.freezeReasons.size > 0;
  }

  getPhase() {
    return this.engine.phase;
  }
}

module.exports = {
  SchedulerService,
  publicSettings,
};

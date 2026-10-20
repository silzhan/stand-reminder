'use strict';

const api = window.sr;
const SVG_NS = 'http://www.w3.org/2000/svg';

const content = document.querySelector('.content');
const tabs = [...document.querySelectorAll('.tab')];
const panels = {
  overview: document.getElementById('panel-overview'),
  settings: document.getElementById('panel-settings'),
};

const heroStatus = document.getElementById('hero-status');
const heroPeriod = document.getElementById('hero-period');
const heroClock = document.getElementById('hero-clock');
const heroCaption = document.getElementById('hero-caption');
const heroSub = document.getElementById('hero-sub');
const heroProgress = document.getElementById('hero-progress');
const heroSchedule = document.getElementById('hero-schedule');
const heroTip = document.getElementById('hero-tip');
const heroPrimary = document.getElementById('hero-primary');
const heroSecondary = document.getElementById('hero-secondary');
const heroError = document.getElementById('hero-error');

const weekRange = document.getElementById('week-range');
const weekChart = document.getElementById('week-chart');
const weekSitting = document.getElementById('week-sitting');
const weekRate = document.getElementById('week-rate');
const weekSnoozes = document.getElementById('week-snoozes');

const todaySitting = document.getElementById('today-sitting');
const todayReminders = document.getElementById('today-reminders');
const todayBreaks = document.getElementById('today-breaks');
const todaySnoozes = document.getElementById('today-snoozes');
const footerDisclaimer = document.getElementById('footer-disclaimer');

const form = document.getElementById('settings-form');
const sitInput = document.getElementById('sit-minutes');
const standInput = document.getElementById('stand-minutes');
const workStartInput = document.getElementById('work-start');
const workEndInput = document.getElementById('work-end');
const lunchEnabledInput = document.getElementById('lunch-enabled');
const lunchStartInput = document.getElementById('lunch-start');
const lunchEndInput = document.getElementById('lunch-end');
const lunchTimes = document.getElementById('lunch-times');
const soundInput = document.getElementById('sound-enabled');
const boardOnTopInput = document.getElementById('board-on-top');
const autoStartInput = document.getElementById('auto-start');
const autostartNote = document.getElementById('autostart-note');
const saveButton = document.getElementById('save-settings');
const saveStatus = document.getElementById('save-status');
const clearButton = document.getElementById('clear-stats');
const clearHint = document.getElementById('clear-hint');
const appVersion = document.getElementById('app-version');
const testNote = document.getElementById('test-note');

const winMinimize = document.getElementById('win-minimize');
const winClose = document.getElementById('win-close');

let latestSnapshot = null;
let currentTab = 'overview';
let busy = false;
let settingsDirty = false;
let saving = false;
let lastSettingsSignature = '';
let heroErrorTimer = null;
let clearArmed = false;
let clearTimer = null;
let saveStatusTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  if (total >= 86400) {
    const totalHours = Math.ceil(total / 3600);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `${days}天${hours}时` : `${days}天`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}` : `${mm}:${ss}`;
}

function formatDuration(ms) {
  const value = Math.max(0, Number(ms || 0));
  if (value === 0) return '0 分钟';
  if (value < 60000) return '不到 1 分钟';
  const totalMinutes = Math.round(value / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  return `${minutes} 分钟`;
}

function formatChartValue(ms) {
  const value = Math.max(0, Number(ms || 0));
  if (value < 60000) return '';
  if (value < 3600000) return `${Math.round(value / 60000)}分`;
  const hours = value / 3600000;
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded}时`;
}

function formatTimeOfDay(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function describeStart(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = formatTimeOfDay(timestamp);
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${time}`;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${weekdays[date.getDay()]} ${time}`;
}

function formatMonthDay(key) {
  if (typeof key !== 'string') return '';
  const parts = key.split('-');
  if (parts.length !== 3) return key;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function scheduleSummary(settings) {
  const schedule = settings.schedule;
  let text = `工作时段 ${schedule.workStart}–${schedule.workEnd}`;
  if (schedule.lunchEnabled) {
    text += ` · 午休 ${schedule.lunchStart}–${schedule.lunchEnd}`;
  }
  return text;
}

function stateInfo(snapshot) {
  if (snapshot.frozen) {
    return {
      label: '计时暂停',
      caption: '锁屏或休眠中',
      clock: '暂停',
      schedule: '恢复后继续剩余计时，期间不计入坐姿',
      primary: null,
      secondary: null,
    };
  }
  switch (snapshot.phase) {
    case 'SITTING':
      return {
        label: '坐姿中',
        caption: '距离起身',
        clock: formatClock(snapshot.remainingMs),
        schedule: `计划 ${formatTimeOfDay(snapshot.dueAt)} 提醒 · 每 ${snapshot.settings.rhythm.sitMinutes} 分钟一次`,
        primary: { label: '暂停 30 分钟', action: 'pause30' },
        secondary: null,
      };
    case 'SNOOZED':
      return {
        label: '已延后',
        caption: '再次提醒',
        clock: formatClock(snapshot.remainingMs),
        schedule: `计划 ${formatTimeOfDay(snapshot.dueAt)} 再次提醒 · 本周期已延后 ${snapshot.cycleSnoozes} 次`,
        primary: { label: '暂停 30 分钟', action: 'pause30' },
        secondary: null,
      };
    case 'REMINDER':
      return {
        label: '该起身了',
        caption: '现在起身活动',
        clock: '起身',
        schedule: '提醒会保持置顶，直到你选择起身或延后',
        primary: { label: '我已起身', action: 'startBreak' },
        secondary: { label: '稍后 5 分钟', action: 'snooze5' },
      };
    case 'BREAK':
      return {
        label: '休息中',
        caption: '休息剩余',
        clock: formatClock(snapshot.remainingMs),
        schedule: `预计 ${formatTimeOfDay(snapshot.breakEndsAt)} 结束 · 完成后自动开始下一轮`,
        primary: { label: '结束休息', action: 'finishBreak' },
        secondary: null,
      };
    case 'PAUSED':
      return {
        label: '已暂停',
        caption: '暂停剩余',
        clock: formatClock(snapshot.remainingMs),
        schedule: snapshot.pausedUntil
          ? `暂停至 ${formatTimeOfDay(snapshot.pausedUntil)}，结束后开始新的坐姿周期`
          : '暂停提醒中',
        primary: { label: '恢复计时', action: 'resume' },
        secondary: null,
      };
    case 'LUNCH':
      return {
        label: '午休中',
        caption: '午休剩余',
        clock: formatClock(snapshot.remainingMs),
        schedule: snapshot.lunchEndAt
          ? `午休结束 ${formatTimeOfDay(snapshot.lunchEndAt)} 后自动继续`
          : '午休期间不提醒',
        primary: null,
        secondary: null,
      };
    case 'IDLE': {
      const next = describeStart(snapshot.nextStartAt);
      return {
        label: '非工作时段',
        caption: '距下次开始',
        clock: formatClock(snapshot.remainingMs),
        schedule: next ? `下次开始 · ${next}` : '非工作时段不提醒',
        primary: null,
        secondary: null,
      };
    }
    default:
      return {
        label: '准备中',
        caption: '正在读取状态',
        clock: '--:--',
        schedule: '正在读取状态',
        primary: null,
        secondary: null,
      };
  }
}

function progressFraction(snapshot) {
  if (snapshot.phase === 'REMINDER') return 1;
  if (!snapshot.phaseTotalMs || snapshot.phaseTotalMs <= 0) return 0;
  return clamp(Number(snapshot.remainingMs || 0) / snapshot.phaseTotalMs, 0, 1);
}

function showHeroError(message) {
  heroError.textContent = message;
  heroError.hidden = false;
  if (heroErrorTimer) clearTimeout(heroErrorTimer);
  heroErrorTimer = setTimeout(() => {
    heroError.hidden = true;
    heroErrorTimer = null;
  }, 5000);
}

function clearHeroError() {
  heroError.hidden = true;
  heroError.textContent = '';
  if (heroErrorTimer) clearTimeout(heroErrorTimer);
  heroErrorTimer = null;
}

function setSaveStatus(message, kind = '') {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('is-success', kind === 'success');
  saveStatus.classList.toggle('is-error', kind === 'error');
  if (saveStatusTimer) clearTimeout(saveStatusTimer);
  saveStatusTimer = null;
  if (message && kind !== 'error') {
    saveStatusTimer = setTimeout(() => {
      if (!settingsDirty) {
        saveStatus.textContent = '';
        saveStatus.classList.remove('is-success');
      }
    }, 4000);
  }
}

function syncActionButtons(snapshot, info) {
  const primary = info.primary;
  const secondary = info.secondary;
  heroPrimary.hidden = !primary;
  heroPrimary.disabled = busy || Boolean(snapshot.frozen);
  if (primary) {
    heroPrimary.textContent = primary.label;
    heroPrimary.dataset.action = primary.action;
  }
  heroSecondary.hidden = !secondary;
  heroSecondary.disabled = busy || Boolean(snapshot.frozen);
  if (secondary) {
    heroSecondary.textContent = secondary.label;
    heroSecondary.dataset.action = secondary.action;
  }
}

function renderOverview(snapshot) {
  document.body.dataset.phase = snapshot.phase;
  document.body.dataset.frozen = String(Boolean(snapshot.frozen));

  const info = stateInfo(snapshot);
  const fraction = progressFraction(snapshot);
  heroStatus.textContent = info.label;
  heroPeriod.textContent = scheduleSummary(snapshot.settings);
  heroClock.textContent = info.clock;
  heroCaption.textContent = info.caption;
  heroSub.textContent = `每 ${snapshot.settings.rhythm.sitMinutes} 分钟坐姿 · ${snapshot.settings.rhythm.standMinutes} 分钟起身`;
  heroProgress.setAttribute('width', (fraction * 100).toFixed(2));
  heroSchedule.textContent = info.schedule;
  heroTip.textContent = snapshot.suggestion || '起身慢走几步，让身体换个姿势。';
  syncActionButtons(snapshot, info);

  footerDisclaimer.textContent = snapshot.disclaimer;

  renderWeek(snapshot.stats);
  const today = snapshot.stats.today;
  todaySitting.textContent = formatDuration(today.sittingMs);
  todayReminders.textContent = `${today.remindersShown} 次`;
  todayBreaks.textContent = `${today.breaksCompleted} / ${today.breaksStarted}`;
  todaySnoozes.textContent = `${today.snoozes} 次`;
}

function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderWeek(stats) {
  const week = stats.week;
  const days = week.days;
  weekRange.textContent = `${formatMonthDay(week.startKey)} – ${formatMonthDay(week.endKey)}`;
  weekSitting.textContent = formatDuration(week.totals.sittingMs);
  weekRate.textContent =
    week.totals.breaksStarted > 0 ? `${week.totals.completionRate}%` : '—';
  weekSnoozes.textContent = `${week.totals.snoozes} 次`;

  const totalMs = Math.max(
    3600000,
    ...days.map((day) => Number(day.sittingMs) || 0),
  );
  const baseline = 124;
  const top = 20;
  const left = 12;
  const width = 320;
  const innerWidth = width - left - 8;
  const slot = innerWidth / 7;
  const barWidth = 20;

  weekChart.replaceChildren();
  weekChart.appendChild(
    svgElement(
      'title',
      {},
      `本周每日坐姿时长：${days
        .map((day) => `${day.label} ${formatDuration(day.sittingMs)}`)
        .join('，')}`,
    ),
  );

  for (const y of [top, 55, 90, baseline]) {
    weekChart.appendChild(
      svgElement('line', {
        x1: left,
        y1: y,
        x2: width - 8,
        y2: y,
        class: y === baseline ? 'chart-baseline' : 'chart-grid-line',
      }),
    );
  }

  days.forEach((day, index) => {
    const centerX = left + slot * (index + 0.5);
    const value = Number(day.sittingMs) || 0;
    const rawHeight = (value / totalMs) * (baseline - top);
    const height = Math.max(value > 0 ? 3 : 2, Math.round(rawHeight));
    const className = day.isFuture
      ? 'chart-bar-future'
      : day.isToday
        ? 'chart-bar-today'
        : 'chart-bar-past';
    weekChart.appendChild(
      svgElement('rect', {
        x: centerX - barWidth / 2,
        y: baseline - height,
        width: barWidth,
        height,
        rx: 4,
        class: className,
      }),
    );

    if (value > 0 && !day.isFuture) {
      weekChart.appendChild(
        svgElement(
          'text',
          {
            x: centerX,
            y: baseline - height - 6,
            class: 'chart-value',
          },
          formatChartValue(value),
        ),
      );
    }

    weekChart.appendChild(
      svgElement(
        'text',
        {
          x: centerX,
          y: 139,
          class: day.isToday ? 'chart-day chart-day-today' : 'chart-day',
        },
        day.label,
      ),
    );
    weekChart.appendChild(
      svgElement(
        'text',
        {
          x: centerX,
          y: 153,
          class: 'chart-date',
        },
        day.shortDate,
      ),
    );
  });
}

function setTab(tab, { focus = false } = {}) {
  currentTab = tab === 'settings' ? 'settings' : 'overview';
  for (const button of tabs) {
    const active = button.dataset.tab === currentTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const [key, panel] of Object.entries(panels)) {
    panel.hidden = key !== currentTab;
  }
  content.scrollTop = 0;
  if (currentTab === 'settings' && latestSnapshot && !settingsDirty) {
    const signature = JSON.stringify(latestSnapshot.settings);
    if (signature !== lastSettingsSignature) {
      lastSettingsSignature = signature;
      populateSettings(latestSnapshot.settings, latestSnapshot.meta);
    }
  }
  if (focus) {
    const active = tabs.find((button) => button.dataset.tab === currentTab);
    if (active) active.focus();
  }
}

function applyMeta(meta) {
  if (!meta) return;
  appVersion.textContent = meta.version || '0.1.0';
  autostartNote.hidden = Boolean(meta.autoStartSupported);
  autoStartInput.disabled = !meta.autoStartSupported;
  testNote.hidden = !meta.testMode;
}

function populateSettings(settings, meta) {
  form.querySelectorAll('input[name="workday"]').forEach((input) => {
    input.checked = settings.schedule.workdays.includes(Number(input.value));
  });
  form.querySelectorAll('input[name="display-mode"]').forEach((input) => {
    input.checked = input.value === settings.displayMode;
  });
  sitInput.value = String(settings.rhythm.sitMinutes);
  standInput.value = String(settings.rhythm.standMinutes);
  workStartInput.value = settings.schedule.workStart;
  workEndInput.value = settings.schedule.workEnd;
  lunchEnabledInput.checked = Boolean(settings.schedule.lunchEnabled);
  lunchStartInput.value = settings.schedule.lunchStart;
  lunchEndInput.value = settings.schedule.lunchEnd;
  lunchTimes.hidden = !settings.schedule.lunchEnabled;
  soundInput.checked = Boolean(settings.soundEnabled);
  boardOnTopInput.checked = Boolean(settings.boardAlwaysOnTop);
  autoStartInput.checked = Boolean(settings.autoStart);
  if (meta) applyMeta(meta);
  settingsDirty = false;
  clearSaveStatusAfterPopulate();
}

function clearSaveStatusAfterPopulate() {
  if (saveStatus.classList.contains('is-error')) return;
  saveStatus.textContent = '';
  saveStatus.classList.remove('is-success');
}

function markDirty() {
  settingsDirty = true;
  saveStatus.textContent = '有未保存的修改';
  saveStatus.classList.remove('is-success', 'is-error');
}

function collectSettings() {
  const checkedMode = form.querySelector('input[name="display-mode"]:checked');
  const workdays = [
    ...form.querySelectorAll('input[name="workday"]:checked'),
  ]
    .map((input) => Number(input.value))
    .sort((a, b) => a - b);

  return {
    displayMode: checkedMode ? checkedMode.value : '',
    autoStart: autoStartInput.checked,
    soundEnabled: soundInput.checked,
    boardAlwaysOnTop: boardOnTopInput.checked,
    schedule: {
      workdays,
      workStart: workStartInput.value,
      workEnd: workEndInput.value,
      lunchEnabled: lunchEnabledInput.checked,
      lunchStart: lunchStartInput.value,
      lunchEnd: lunchEndInput.value,
    },
    rhythm: {
      sitMinutes: Number(sitInput.value),
      standMinutes: Number(standInput.value),
    },
  };
}

async function runHeroAction(action) {
  if (!latestSnapshot || busy) return;
  busy = true;
  clearHeroError();
  syncActionButtons(latestSnapshot, stateInfo(latestSnapshot));
  try {
    let next = null;
    if (action === 'pause30') next = await api.pause(30);
    else if (action === 'startBreak') next = await api.startBreak();
    else if (action === 'snooze5') next = await api.snooze(5);
    else if (action === 'finishBreak') next = await api.finishBreak();
    else if (action === 'resume') next = await api.resume();
    if (next) {
      latestSnapshot = next;
      render(next);
    }
  } catch (error) {
    showHeroError(error && error.message ? error.message : '操作未完成，请重试');
  } finally {
    busy = false;
    if (latestSnapshot) renderOverview(latestSnapshot);
  }
}

function resetClearConfirmation() {
  clearArmed = false;
  clearButton.classList.remove('is-confirming');
  clearButton.textContent = '清除全部统计';
  clearHint.textContent = '删除后无法恢复';
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
}

async function onClearStats() {
  if (!clearArmed) {
    clearArmed = true;
    clearButton.classList.add('is-confirming');
    clearButton.textContent = '再次点击确认清除';
    clearHint.textContent = '将删除最近 30 天的全部统计';
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(resetClearConfirmation, 5000);
    return;
  }
  resetClearConfirmation();
  clearButton.disabled = true;
  try {
    const snapshot = await api.clearStats();
    if (snapshot) {
      latestSnapshot = snapshot;
      render(snapshot);
    }
    setSaveStatus('统计已清除', 'success');
  } catch (error) {
    setSaveStatus(
      error && error.message ? error.message : '清除统计失败',
      'error',
    );
  } finally {
    clearButton.disabled = false;
  }
}

function render(snapshot) {
  if (!snapshot) return;
  latestSnapshot = snapshot;
  applyMeta(snapshot.meta);
  renderOverview(snapshot);

  if (!settingsDirty) {
    const signature = JSON.stringify(snapshot.settings);
    if (signature !== lastSettingsSignature) {
      lastSettingsSignature = signature;
      populateSettings(snapshot.settings, snapshot.meta);
    }
  }
}

for (const button of tabs) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
}

form.addEventListener('input', markDirty);

lunchEnabledInput.addEventListener('change', () => {
  lunchTimes.hidden = !lunchEnabledInput.checked;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  clearHeroError();
  saveButton.disabled = true;
  saveButton.textContent = '保存中';
  setSaveStatus('正在保存…');

  try {
    const snapshot = await api.updateSettings(collectSettings());
    if (snapshot) {
      settingsDirty = false;
      latestSnapshot = snapshot;
      lastSettingsSignature = JSON.stringify(snapshot.settings);
      populateSettings(snapshot.settings, snapshot.meta);
      render(snapshot);
    }
    setSaveStatus('设置已保存', 'success');
  } catch (error) {
    setSaveStatus(
      error && error.message ? error.message : '设置未保存，请检查输入',
      'error',
    );
  } finally {
    saving = false;
    saveButton.disabled = false;
    saveButton.textContent = '保存设置';
  }
});

clearButton.addEventListener('click', onClearStats);

heroPrimary.addEventListener('click', () => {
  const action = heroPrimary.dataset.action;
  if (action) runHeroAction(action);
});

heroSecondary.addEventListener('click', () => {
  const action = heroSecondary.dataset.action;
  if (action) runHeroAction(action);
});

winMinimize.addEventListener('click', () => {
  api.minimizeBoard().catch(() => {});
});

winClose.addEventListener('click', () => {
  api.closeBoard().catch(() => {});
});

api.onSnapshot(render);
api.onNavigate((payload) => {
  if (payload && payload.tab) setTab(payload.tab);
});

api
  .getSnapshot()
  .then((snapshot) => {
    render(snapshot);
  })
  .catch((error) => {
    showHeroError(error && error.message ? error.message : '无法读取状态');
  });

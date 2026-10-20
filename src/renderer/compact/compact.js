'use strict';

const api = window.sr;

const widget = document.getElementById('widget');
const widgetDot = document.getElementById('widget-dot');
const widgetState = document.getElementById('widget-state');
const widgetClock = document.getElementById('widget-clock');
const widgetHint = document.getElementById('widget-hint');
const widgetProgress = document.getElementById('widget-progress');
const widgetPrimary = document.getElementById('widget-primary');
const widgetBoard = document.getElementById('widget-board');

const orb = document.getElementById('orb');
const orbProgress = document.getElementById('orb-progress');
const orbCenter = document.getElementById('orb-center');
const orbValue = document.getElementById('orb-value');
const orbUnit = document.getElementById('orb-unit');
const orbLabel = document.getElementById('orb-label');

let latestSnapshot = null;
let busy = false;
let transientError = '';
let errorTimer = null;

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

function describeStart(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${time}`;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${weekdays[date.getDay()]} ${time}`;
}

function orbNumber(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  if (total >= 86400) return { value: String(Math.ceil(total / 86400)), unit: '天' };
  if (total >= 3600) return { value: String(Math.ceil(total / 3600)), unit: '时' };
  if (total >= 60) return { value: String(Math.ceil(total / 60)), unit: '分' };
  return { value: String(total), unit: '秒' };
}

function stateInfo(snapshot) {
  if (snapshot.frozen) {
    return {
      label: '计时暂停',
      hint: '锁屏或休眠中，计时会保留',
      orbLabel: '暂停',
      message: true,
      frozen: true,
    };
  }
  switch (snapshot.phase) {
    case 'SITTING':
      return {
        label: '坐姿中',
        hint: `距离起身 · 坐 ${snapshot.settings.rhythm.sitMinutes} 分钟`,
        orbLabel: '坐姿',
        primary: 'pause',
        primaryLabel: '暂停 30 分钟',
        primaryTitle: '暂停提醒 30 分钟',
      };
    case 'SNOOZED':
      return {
        label: '已延后',
        hint: `再次提醒 · 已延后 ${snapshot.cycleSnoozes} 次`,
        orbLabel: '延后',
        primary: 'pause',
        primaryLabel: '暂停 30 分钟',
        primaryTitle: '暂停提醒 30 分钟',
      };
    case 'REMINDER':
      return {
        label: '该起身了',
        hint: '现在起身活动一下',
        orbLabel: '请活动',
        message: true,
        primary: 'startBreak',
        primaryLabel: '我已起身',
        primaryTitle: '开始休息计时',
      };
    case 'BREAK':
      return {
        label: '休息中',
        hint: `起身活动 · 共 ${snapshot.settings.rhythm.standMinutes} 分钟`,
        orbLabel: '休息',
        primary: 'finishBreak',
        primaryLabel: '结束休息',
        primaryTitle: '提前结束本次休息',
      };
    case 'PAUSED':
      return {
        label: '已暂停',
        hint: '暂停提醒中',
        orbLabel: '暂停',
        primary: 'resume',
        primaryLabel: '恢复计时',
        primaryTitle: '立即恢复提醒',
      };
    case 'LUNCH':
      return {
        label: '午休中',
        hint: '午休期间不提醒',
        orbLabel: '午休',
      };
    case 'IDLE': {
      const next = describeStart(snapshot.nextStartAt);
      return {
        label: '非工作时段',
        hint: next ? `下次开始 · ${next}` : '非工作时段',
        orbLabel: '待机',
      };
    }
    default:
      return {
        label: '准备中',
        hint: '正在读取状态',
        orbLabel: '待机',
      };
  }
}

function progressFraction(snapshot) {
  if (snapshot.phase === 'REMINDER') return 1;
  if (!snapshot.phaseTotalMs || snapshot.phaseTotalMs <= 0) return 0;
  return clamp(Number(snapshot.remainingMs || 0) / snapshot.phaseTotalMs, 0, 1);
}

function setTransientError(message) {
  transientError = message;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    transientError = '';
    errorTimer = null;
    if (latestSnapshot) render(latestSnapshot);
  }, 4000);
  if (latestSnapshot) render(latestSnapshot);
}

function clearTransientError() {
  transientError = '';
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = null;
}

function syncButton() {
  if (!latestSnapshot) return;
  const info = stateInfo(latestSnapshot);
  const visible = Boolean(info.primary) && !busy;
  widgetPrimary.hidden = !visible;
  widgetPrimary.disabled = busy || Boolean(info.frozen);
  if (info.primary) {
    widgetPrimary.textContent = info.primaryLabel;
    widgetPrimary.title = info.primaryTitle || info.primaryLabel;
  }
}

function render(snapshot) {
  if (!snapshot) return;
  latestSnapshot = snapshot;
  const info = stateInfo(snapshot);
  const mode = snapshot.settings.displayMode === 'orb' ? 'orb' : 'widget';

  document.body.dataset.mode = mode;
  document.body.dataset.phase = snapshot.phase;
  document.body.dataset.frozen = String(Boolean(snapshot.frozen));
  widget.hidden = mode !== 'widget';
  orb.hidden = mode !== 'orb';

  const clockText = snapshot.frozen
    ? '已暂停'
    : snapshot.phase === 'REMINDER'
      ? '起身'
      : formatClock(snapshot.remainingMs);
  const hintText = transientError || info.hint;
  const fraction = progressFraction(snapshot);
  const percent = (fraction * 100).toFixed(2);

  widgetState.textContent = info.label;
  widgetClock.textContent = clockText;
  widgetHint.textContent = hintText;
  widgetHint.title = hintText;
  widgetProgress.setAttribute('width', percent);
  widgetDot.title = info.label;
  widget.title = `起身助手 · ${info.label}`;

  const primaryVisible = Boolean(info.primary);
  widgetPrimary.hidden = !primaryVisible;
  widgetPrimary.disabled = busy || Boolean(info.frozen);
  if (primaryVisible) {
    widgetPrimary.textContent = info.primaryLabel;
    widgetPrimary.title = info.primaryTitle || info.primaryLabel;
  }
  widgetBoard.disabled = busy;

  orbProgress.setAttribute('stroke-dashoffset', String(100 - fraction * 100));
  orb.dataset.kind = info.message ? 'message' : 'number';
  if (info.message) {
    orbValue.textContent =
      snapshot.frozen ? '暂停' : snapshot.phase === 'REMINDER' ? '起身' : info.orbLabel;
    orbUnit.textContent = '';
  } else {
    const numeric = orbNumber(snapshot.remainingMs);
    orbValue.textContent = numeric.value;
    orbUnit.textContent = numeric.unit;
  }
  orbLabel.textContent = info.orbLabel;
  orbCenter.setAttribute(
    'aria-label',
    `${info.label}，${hintText}${clockText ? `，${clockText}` : ''}，点击打开看板`,
  );
  orbCenter.title = `${info.label} · 点击打开看板`;
}

async function runPrimary() {
  if (!latestSnapshot || busy) return;
  const phase = latestSnapshot.phase;
  if (latestSnapshot.frozen) return;

  busy = true;
  clearTransientError();
  syncButton();
  try {
    let next = null;
    if (phase === 'SITTING' || phase === 'SNOOZED') {
      next = await api.pause(30);
    } else if (phase === 'REMINDER') {
      next = await api.startBreak();
    } else if (phase === 'BREAK') {
      next = await api.finishBreak();
    } else if (phase === 'PAUSED') {
      next = await api.resume();
    }
    if (next) {
      busy = false;
      render(next);
      return;
    }
  } catch (error) {
    setTransientError(error && error.message ? error.message : '操作未完成，请重试');
  } finally {
    busy = false;
    if (latestSnapshot) {
      syncButton();
      render(latestSnapshot);
    }
  }
}

async function openBoard() {
  try {
    await api.openBoard('overview');
  } catch (error) {
    setTransientError(error && error.message ? error.message : '无法打开看板');
  }
}

widgetPrimary.addEventListener('click', (event) => {
  event.stopPropagation();
  runPrimary();
});

widgetBoard.addEventListener('click', (event) => {
  event.stopPropagation();
  openBoard();
});

orbCenter.addEventListener('click', (event) => {
  event.stopPropagation();
  openBoard();
});

api.onSnapshot(render);

api
  .getSnapshot()
  .then((snapshot) => {
    if (snapshot) render(snapshot);
  })
  .catch((error) => {
    setTransientError(error && error.message ? error.message : '无法读取状态');
  });

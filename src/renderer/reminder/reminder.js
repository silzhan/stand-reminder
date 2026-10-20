'use strict';

const api = window.sr;

const badge = document.getElementById('alert-badge');
const eyebrow = document.getElementById('eyebrow');
const headline = document.getElementById('headline');
const lead = document.getElementById('lead');
const tipText = document.getElementById('tip-text');
const disclaimerText = document.getElementById('disclaimer-text');
const standDuration = document.getElementById('stand-duration');
const startButton = document.getElementById('start-break');
const snoozeButtons = [
  document.getElementById('snooze-5'),
  document.getElementById('snooze-10'),
];
const actionStatus = document.getElementById('action-status');
const actionError = document.getElementById('action-error');

const FALLBACK_DISCLAIMER =
  '如起身时疼痛或腿麻加重，请停止活动并咨询医生。';

const LEVEL_COPY = {
  0: {
    badge: '到时间了',
    headline: '该起身了',
    lead: '站起来走几步，让腰背换个姿势。',
  },
  1: {
    badge: '该起身了',
    headline: '该起身了',
    lead: '已经提醒过一次了。现在起身，哪怕只走两分钟。',
  },
  2: {
    badge: '已经等了一会儿',
    headline: '还在等您起身',
    lead: '坐得越久，腰背越容易僵。先离开椅子活动一下再回来。',
  },
  3: {
    badge: '请尽快起身',
    headline: '先起身走走吧',
    lead: '别再等啦，站起来放松一下腰背，慢慢走几步。',
  },
};

let busy = false;
let audioContext = null;
let currentReminderId = null;

function describeSitting(ms, snoozes) {
  const minutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
  const base = `已连续坐着 ${minutes} 分钟`;
  const count = Math.max(0, Math.floor(Number(snoozes) || 0));
  return count > 0 ? `${base} · 已延后 ${count} 次` : base;
}

function setControlsDisabled(disabled) {
  startButton.disabled = disabled;
  for (const button of snoozeButtons) button.disabled = disabled;
}

function clearFeedback() {
  actionStatus.hidden = true;
  actionStatus.textContent = '';
  actionError.hidden = true;
  actionError.textContent = '';
}

function showError(message) {
  actionStatus.hidden = true;
  actionError.textContent = message;
  actionError.hidden = false;
}

function ensureAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    audioContext = new AudioContextClass();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

function scheduleNote(context, frequency, startAt, duration, volume) {
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(volume, startAt + 0.035);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  envelope.connect(context.destination);

  const tone = context.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(frequency, startAt);
  tone.connect(envelope);
  tone.start(startAt);
  tone.stop(startAt + duration + 0.05);

  const shimmer = context.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(frequency * 2, startAt);
  const shimmerGain = context.createGain();
  shimmerGain.gain.setValueAtTime(volume * 0.16, startAt);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration * 0.6);
  shimmer.connect(shimmerGain);
  shimmerGain.connect(context.destination);
  shimmer.start(startAt);
  shimmer.stop(startAt + duration * 0.6 + 0.05);
}

function playChime(level) {
  const context = ensureAudioContext();
  if (!context) return;
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  const notes = level >= 2 ? [523.25, 659.25, 783.99] : [659.25, 783.99];
  const volume = level >= 2 ? 0.085 : 0.07;
  const startAt = context.currentTime + 0.06;
  notes.forEach((frequency, index) => {
    scheduleNote(context, frequency, startAt + index * 0.24, 0.85, volume);
  });
}

function render(payload) {
  if (!payload || !payload.reminderId) return;
  const level = Math.min(3, Math.max(0, Math.floor(Number(payload.level) || 0)));
  const copy = LEVEL_COPY[level] || LEVEL_COPY[0];

  if (payload.reminderId !== currentReminderId) {
    currentReminderId = payload.reminderId;
    busy = false;
    setControlsDisabled(false);
    clearFeedback();
  }

  document.body.dataset.level = String(level);
  badge.textContent = copy.badge;
  headline.textContent = copy.headline;
  eyebrow.textContent = describeSitting(
    payload.sittingElapsedMs,
    payload.cycleSnoozes,
  );
  lead.textContent = copy.lead;
  tipText.textContent = payload.tip || '起身慢走几步，让身体换个姿势。';
  disclaimerText.textContent = payload.disclaimer || FALLBACK_DISCLAIMER;
  standDuration.textContent = `休息 ${Number(payload.standMinutes) || 5} 分钟，慢慢走一走`;
  document.title = copy.headline;

  if (payload.playSound) playChime(level);
}

async function act(statusText, action) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  clearFeedback();
  actionStatus.textContent = statusText;
  actionStatus.hidden = false;

  try {
    await action();
    actionStatus.textContent = '已记录，起身慢慢走一走。';
  } catch (error) {
    busy = false;
    setControlsDisabled(false);
    showError(error && error.message ? error.message : '操作未完成，请重试');
  }
}

startButton.addEventListener('click', () => {
  act('正在开始休息…', () => api.startBreak());
});

for (const button of snoozeButtons) {
  button.addEventListener('click', () => {
    const minutes = Number(button.dataset.minutes);
    act(`正在延后 ${minutes} 分钟…`, () => api.snooze(minutes));
  });
}

api.onReminder(render);

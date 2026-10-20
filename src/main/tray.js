'use strict';

const { Menu, Tray, nativeImage } = require('electron');
const { describeNextStart } = require('../shared/schedule');

const MODE_LABELS = Object.freeze({
  tray: '仅托盘',
  widget: '置顶小挂件',
  orb: '悬浮球',
  board: '桌面看板',
});

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

function statusText(snapshot) {
  if (!snapshot) return '正在启动';
  if (snapshot.frozen) {
    return `计时已暂停（锁屏或休眠）· 剩余 ${formatRemaining(snapshot.remainingMs)}`;
  }
  switch (snapshot.phase) {
    case 'SITTING':
      return `坐姿中 · 还剩 ${formatRemaining(snapshot.remainingMs)}`;
    case 'SNOOZED':
      return `已延后 · ${formatRemaining(snapshot.remainingMs)}后再提醒`;
    case 'REMINDER':
      return '该起身了 · 等待确认';
    case 'BREAK':
      return `休息中 · 还剩 ${formatRemaining(snapshot.remainingMs)}`;
    case 'PAUSED':
      return `已暂停 · ${formatRemaining(snapshot.remainingMs)}后恢复`;
    case 'LUNCH':
      return `午休中 · ${formatRemaining(snapshot.remainingMs)}后继续`;
    case 'IDLE': {
      const next = describeNextStart(snapshot.nextStartAt);
      return next ? `非工作时段 · ${next}开始` : '非工作时段';
    }
    default:
      return '起身助手';
  }
}

function tooltipFor(snapshot) {
  return `起身助手\n${statusText(snapshot)}\n单击打开看板`;
}

class TrayController {
  constructor({ iconPath, scheduler, windows, actions }) {
    this.iconPath = iconPath;
    this.scheduler = scheduler;
    this.windows = windows;
    this.actions = actions;
    this.tray = null;
    this.signature = '';
    this.lastSnapshot = null;
  }

  create() {
    if (this.tray) return;
    const image = nativeImage.createFromPath(this.iconPath);
    this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
    this.tray.setToolTip('起身助手');
    this.tray.on('click', () => {
      this.actions.openBoard('overview').catch(() => {});
    });
    this.update(this.scheduler.getSnapshot());
  }

  _signatureFor(snapshot) {
    const bucket =
      snapshot.remainingMs > 60000
        ? Math.ceil(snapshot.remainingMs / 60000)
        : Math.ceil(snapshot.remainingMs / 1000);
    return JSON.stringify({
      phase: snapshot.phase,
      frozen: snapshot.frozen,
      bucket,
      mode: snapshot.settings.displayMode,
      paused: snapshot.phase === 'PAUSED',
    });
  }

  update(snapshot) {
    if (!this.tray) return;
    this.lastSnapshot = snapshot;
    this.tray.setToolTip(tooltipFor(snapshot));
    const signature = this._signatureFor(snapshot);
    if (signature === this.signature) return;
    this.signature = signature;

    const mode = snapshot.settings.displayMode;
    const displayItems = Object.entries(MODE_LABELS).map(([value, label]) => ({
      label,
      type: 'radio',
      checked: mode === value,
      click: () => {
        this.actions.setDisplayMode(value).catch(() => {});
      },
    }));

    const frozen = snapshot.frozen;
    const template = [
      { label: statusText(snapshot), enabled: false },
      { type: 'separator' },
      {
        label: '打开看板',
        click: () => {
          this.actions.openBoard('overview').catch(() => {});
        },
      },
      { label: '显示模式', submenu: displayItems },
      { type: 'separator' },
      {
        label: '暂停提醒',
        submenu: [
          {
            label: '暂停 30 分钟',
            enabled: !frozen,
            click: () => this.actions.pause(30),
          },
          {
            label: '暂停 1 小时',
            enabled: !frozen,
            click: () => this.actions.pause(60),
          },
          {
            label: '暂停今天',
            enabled: !frozen,
            click: () => this.actions.pause('today'),
          },
        ],
      },
      {
        label: '恢复计时',
        enabled: snapshot.phase === 'PAUSED' && !frozen,
        click: () => this.actions.resume(),
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => this.actions.quit(),
      },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = {
  MODE_LABELS,
  TrayController,
  formatRemaining,
  statusText,
};

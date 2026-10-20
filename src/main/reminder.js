'use strict';

const { BrowserWindow, screen } = require('electron');

const REMINDER_WIDTH = 552;
const REMINDER_HEIGHT = 368;
const EDGE_GAP = 22;

function clampToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

function intersectsDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const width = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x),
    );
    const height = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y),
    );
    return width >= 100 && height >= 80;
  });
}

class ReminderController {
  constructor({ preloadPath, pagePath, iconPath, scheduler, isQuitting }) {
    this.preloadPath = preloadPath;
    this.pagePath = pagePath;
    this.iconPath = iconPath;
    this.scheduler = scheduler;
    this.isQuitting = isQuitting;
    this.window = null;
    this.loadPromise = null;
    this.visible = false;
    this.currentPayload = null;
    this.saveTimer = null;
    this.placing = false;
    this.lastSoundKey = null;
    this.onDisplayChanged = () => this.ensureVisibleOnScreen();
    screen.on('display-removed', this.onDisplayChanged);
    screen.on('display-metrics-changed', this.onDisplayChanged);
  }

  createBrowserWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const saved = this.scheduler.settings.bounds.reminder;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    const fallback = {
      x: workArea.x + workArea.width - REMINDER_WIDTH - EDGE_GAP,
      y: workArea.y + workArea.height - REMINDER_HEIGHT - EDGE_GAP,
      width: REMINDER_WIDTH,
      height: REMINDER_HEIGHT,
    };
    const initial =
      saved && intersectsDisplay({ ...saved, width: REMINDER_WIDTH, height: REMINDER_HEIGHT })
        ? { ...saved, width: REMINDER_WIDTH, height: REMINDER_HEIGHT }
        : fallback;

    this.window = new BrowserWindow({
      ...clampToWorkArea(initial, workArea),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: '该起身了',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.removeMenu();
    this.window.setMenuBarVisibility(false);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.on('close', (event) => {
      if (!this.isQuitting()) {
        event.preventDefault();
        if (this.visible) {
          this.window.showInactive();
          this.window.moveTop();
        }
      }
    });
    this.window.on('moved', () => {
      if (this.placing) return;
      this._queueBoundsSave();
    });
    this.window.on('closed', () => {
      this.window = null;
      this.loadPromise = null;
      this.visible = false;
      this.lastSoundKey = null;
    });
    return this.window;
  }

  async load() {
    if (!this.window) this.createBrowserWindow();
    if (!this.loadPromise) {
      this.loadPromise = this.window.loadFile(this.pagePath).catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    await this.loadPromise;
  }

  _defaultBounds() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    return {
      x: area.x + area.width - REMINDER_WIDTH - EDGE_GAP,
      y: area.y + area.height - REMINDER_HEIGHT - EDGE_GAP,
      width: REMINDER_WIDTH,
      height: REMINDER_HEIGHT,
    };
  }

  ensureVisibleOnScreen() {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    if (intersectsDisplay(bounds)) {
      const display = screen.getDisplayMatching(bounds);
      const clamped = clampToWorkArea(
        { ...bounds, width: REMINDER_WIDTH, height: REMINDER_HEIGHT },
        display.workArea,
      );
      if (JSON.stringify(clamped) !== JSON.stringify(bounds)) {
        this.placing = true;
        this.window.setBounds(clamped);
        setTimeout(() => {
          this.placing = false;
        }, 80);
      }
      return;
    }
    this.placing = true;
    this.window.setBounds(this._defaultBounds());
    setTimeout(() => {
      this.placing = false;
    }, 80);
  }

  _queueBoundsSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.window || this.window.isDestroyed()) return;
      this.scheduler.setBounds('reminder', this.window.getBounds());
    }, 400);
  }

  _send(payload) {
    if (!this.window || this.window.isDestroyed()) return;
    const soundKey = `${payload.reminderId}:${payload.level}`;
    const playSound = Boolean(payload.soundEnabled) && soundKey !== this.lastSoundKey;
    if (playSound) this.lastSoundKey = soundKey;
    this.window.webContents.send('sr:reminder-data', {
      ...payload,
      playSound,
      receivedAt: Date.now(),
    });
  }

  async present(payload) {
    await this.load();
    if (!this.window || this.window.isDestroyed()) {
      this.loadPromise = null;
      await this.load();
    }
    this.currentPayload = payload;
    const wasVisible = this.visible;
    this.ensureVisibleOnScreen();
    this._send(payload);
    if (!wasVisible || !this.window.isVisible()) {
      this.window.showInactive();
      this.visible = true;
    } else {
      this.window.moveTop();
    }
  }

  hide() {
    this.lastSoundKey = null;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    this.visible = false;
  }

  flushBounds() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.window || this.window.isDestroyed()) return;
    this.scheduler.setBounds('reminder', this.window.getBounds());
  }

  destroy() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    screen.removeListener('display-removed', this.onDisplayChanged);
    screen.removeListener('display-metrics-changed', this.onDisplayChanged);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.loadPromise = null;
    this.lastSoundKey = null;
  }
}

module.exports = {
  REMINDER_HEIGHT,
  REMINDER_WIDTH,
  ReminderController,
};

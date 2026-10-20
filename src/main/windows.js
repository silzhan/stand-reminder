'use strict';

const { BrowserWindow, screen } = require('electron');

const WIDGET_SIZE = Object.freeze({ width: 344, height: 140 });
const ORB_SIZE = Object.freeze({ width: 100, height: 100 });
const BOARD_SIZE = Object.freeze({ width: 980, height: 700 });
const BOARD_MIN_SIZE = Object.freeze({ width: 840, height: 620 });
const EDGE_GAP = 24;
const SAVE_DELAY_MS = 350;

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
    return width >= 80 && height >= 60;
  });
}

function clampToWorkArea(bounds, workArea) {
  const width = Math.max(1, Math.min(bounds.width, workArea.width));
  const height = Math.max(1, Math.min(bounds.height, workArea.height));
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

function centeredOn(area, size) {
  return {
    x: area.x + Math.round((area.width - size.width) / 2),
    y: area.y + Math.round((area.height - size.height) / 2),
    ...size,
  };
}

class WindowManager {
  constructor({
    preloadPath,
    compactPage,
    boardPage,
    iconPath,
    scheduler,
    isQuitting,
  }) {
    this.preloadPath = preloadPath;
    this.compactPage = compactPage;
    this.boardPage = boardPage;
    this.iconPath = iconPath;
    this.scheduler = scheduler;
    this.isQuitting = isQuitting;
    this.compact = null;
    this.compactLoad = null;
    this.compactMode = null;
    this.board = null;
    this.boardLoad = null;
    this.boardTab = 'overview';
    this.saveTimers = new Map();
    this.suppressSaveUntil = 0;
    this.destroying = false;
    this.onDisplayChanged = () => this.ensureVisible();
    screen.on('display-removed', this.onDisplayChanged);
    screen.on('display-metrics-changed', this.onDisplayChanged);
  }

  _suppressSaves() {
    this.suppressSaveUntil = Date.now() + 180;
  }

  _isSavingSuppressed() {
    return Date.now() < this.suppressSaveUntil;
  }

  _scheduleSave(mode, win) {
    if (this._isSavingSuppressed() || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const existing = this.saveTimers.get(mode);
    if (existing) clearTimeout(existing);
    this.saveTimers.set(
      mode,
      setTimeout(() => {
        this.saveTimers.delete(mode);
        if (win.isDestroyed()) return;
        this.scheduler.setBounds(mode, bounds);
      }, SAVE_DELAY_MS),
    );
  }

  _defaultCompactBounds(mode, area = screen.getPrimaryDisplay().workArea) {
    const size = mode === 'orb' ? ORB_SIZE : WIDGET_SIZE;
    if (mode === 'orb') {
      return clampToWorkArea(
        {
          x: area.x + area.width - size.width - EDGE_GAP,
          y: area.y + Math.round((area.height - size.height) / 2),
          ...size,
        },
        area,
      );
    }
    return clampToWorkArea(
      {
        x: area.x + area.width - size.width - EDGE_GAP,
        y: area.y + area.height - size.height - EDGE_GAP,
        ...size,
      },
      area,
    );
  }

  _compactBoundsFor(mode) {
    const size = mode === 'orb' ? ORB_SIZE : WIDGET_SIZE;
    const saved = (this.scheduler.settings.bounds || {})[mode];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const display = screen.getDisplayMatching({
        x: saved.x,
        y: saved.y,
        width: size.width,
        height: size.height,
      });
      const candidate = {
        x: saved.x,
        y: saved.y,
        width: size.width,
        height: size.height,
      };
      if (intersectsDisplay(candidate)) {
        return clampToWorkArea(candidate, display.workArea);
      }
    }

    if (this.compact && !this.compact.isDestroyed()) {
      const current = this.compact.getBounds();
      const display = screen.getDisplayMatching(current);
      const candidate = {
        x: Math.round(current.x + (current.width - size.width) / 2),
        y: Math.round(current.y + (current.height - size.height) / 2),
        width: size.width,
        height: size.height,
      };
      if (intersectsDisplay(candidate)) {
        return clampToWorkArea(candidate, display.workArea);
      }
      return clampToWorkArea(candidate, display.workArea);
    }

    return this._defaultCompactBounds(mode);
  }

  _createCompactWindow(mode) {
    if (this.compact && !this.compact.isDestroyed()) return this.compact;
    const bounds = this._compactBoundsFor(mode);
    this.compactMode = mode;
    this._suppressSaves();
    this.compact = new BrowserWindow({
      ...bounds,
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
      title: '起身助手',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    this.compact.setAlwaysOnTop(true, 'floating');
    this.compact.removeMenu();
    this.compact.setMenuBarVisibility(false);
    this.compact.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.compact.webContents.on('will-navigate', (event) => event.preventDefault());
    this.compact.on('close', (event) => {
      if (!this.isQuitting()) {
        event.preventDefault();
        this.compact.hide();
      }
    });
    this.compact.on('moved', () => {
      if (this.compactMode) this._scheduleSave(this.compactMode, this.compact);
    });
    this.compact.on('closed', () => {
      this.compact = null;
      this.compactLoad = null;
      this.compactMode = null;
    });
    return this.compact;
  }

  async _loadCompact() {
    if (!this.compact || this.compact.isDestroyed()) {
      throw new Error('小挂件窗口不可用');
    }
    if (!this.compactLoad) {
      this.compactLoad = this.compact.loadFile(this.compactPage).catch((error) => {
        this.compactLoad = null;
        throw error;
      });
    }
    await this.compactLoad;
  }

  async ensureCompact(mode) {
    const targetMode = mode === 'orb' ? 'orb' : 'widget';
    if (!this.compact || this.compact.isDestroyed()) {
      this._createCompactWindow(targetMode);
      await this._loadCompact();
    } else if (this.compactMode !== targetMode) {
      const bounds = this._compactBoundsFor(targetMode);
      this.compactMode = targetMode;
      this._suppressSaves();
      this.compact.setBounds(bounds);
    }

    if (!this.compact || this.compact.isDestroyed()) return;
    this.compact.webContents.send('sr:snapshot', this.scheduler.getSnapshot());
    if (!this.compact.isVisible()) this.compact.showInactive();
  }

  _createBoardWindow() {
    if (this.board && !this.board.isDestroyed()) return this.board;
    const saved = (this.scheduler.settings.bounds || {}).board;
    const fallbackArea = screen.getPrimaryDisplay().workArea;
    let bounds;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const display = screen.getDisplayMatching({
        x: saved.x,
        y: saved.y,
        width: Math.max(1, saved.width || BOARD_SIZE.width),
        height: Math.max(1, saved.height || BOARD_SIZE.height),
      });
      const area = display.workArea;
      const width = Math.max(
        Math.min(BOARD_MIN_SIZE.width, area.width),
        Math.min(saved.width || BOARD_SIZE.width, area.width),
      );
      const height = Math.max(
        Math.min(BOARD_MIN_SIZE.height, area.height),
        Math.min(saved.height || BOARD_SIZE.height, area.height),
      );
      bounds = clampToWorkArea(
        { x: saved.x, y: saved.y, width, height },
        area,
      );
    } else {
      const width = Math.min(BOARD_SIZE.width, fallbackArea.width);
      const height = Math.min(BOARD_SIZE.height, fallbackArea.height);
      bounds = centeredOn(fallbackArea, {
        width: Math.max(Math.min(BOARD_MIN_SIZE.width, fallbackArea.width), width),
        height: Math.max(Math.min(BOARD_MIN_SIZE.height, fallbackArea.height), height),
      });
    }

    this._suppressSaves();
    this.board = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#f3ede2',
      hasShadow: true,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: false,
      skipTaskbar: false,
      alwaysOnTop: Boolean(this.scheduler.settings.boardAlwaysOnTop),
      minWidth: Math.min(BOARD_MIN_SIZE.width, fallbackArea.width),
      minHeight: Math.min(BOARD_MIN_SIZE.height, fallbackArea.height),
      title: '起身助手',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    this.applyBoardAlwaysOnTop();
    this.board.removeMenu();
    this.board.setMenuBarVisibility(false);
    this.board.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.board.webContents.on('will-navigate', (event) => event.preventDefault());
    this.board.on('close', (event) => {
      if (!this.isQuitting()) {
        event.preventDefault();
        this.board.hide();
      }
    });
    this.board.on('moved', () => this._scheduleSave('board', this.board));
    this.board.on('resized', () => this._scheduleSave('board', this.board));
    this.board.on('closed', () => {
      this.board = null;
      this.boardLoad = null;
    });
    return this.board;
  }

  async _loadBoard() {
    if (!this.board || this.board.isDestroyed()) {
      throw new Error('看板窗口不可用');
    }
    if (!this.boardLoad) {
      this.boardLoad = this.board.loadFile(this.boardPage).catch((error) => {
        this.boardLoad = null;
        throw error;
      });
    }
    await this.boardLoad;
  }

  async openBoard(tab = 'overview', { focus = true } = {}) {
    this.boardTab = tab === 'settings' ? 'settings' : 'overview';
    this._createBoardWindow();
    await this._loadBoard();
    if (!this.board || this.board.isDestroyed()) return;
    this.board.webContents.send('sr:navigate', { tab: this.boardTab });
    this.board.webContents.send('sr:snapshot', this.scheduler.getSnapshot());
    if (!this.board.isVisible()) {
      if (focus) {
        this.board.show();
        this.board.focus();
      } else {
        this.board.showInactive();
      }
    } else if (focus) {
      this.board.focus();
    }
  }

  hideBoard() {
    if (this.board && !this.board.isDestroyed()) this.board.hide();
  }

  minimizeBoard() {
    if (this.board && !this.board.isDestroyed()) this.board.minimize();
  }

  hideCompact() {
    if (this.compact && !this.compact.isDestroyed()) this.compact.hide();
  }

  async applyDisplayMode(mode, { focus = false } = {}) {
    if (!['tray', 'widget', 'orb', 'board'].includes(mode)) return;
    if (mode === 'tray') {
      this.hideCompact();
      this.hideBoard();
      return;
    }
    if (mode === 'widget' || mode === 'orb') {
      this.hideBoard();
      await this.ensureCompact(mode);
      return;
    }
    this.hideCompact();
    await this.openBoard('overview', { focus });
  }

  applyBoardAlwaysOnTop() {
    if (!this.board || this.board.isDestroyed()) return;
    const enabled = Boolean(this.scheduler.settings.boardAlwaysOnTop);
    this.board.setAlwaysOnTop(enabled, 'floating');
  }

  sendSnapshot(snapshot) {
    for (const win of [this.compact, this.board]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('sr:snapshot', snapshot);
      }
    }
  }

  ensureVisible() {
    const compact = this.compact;
    if (compact && !compact.isDestroyed() && this.compactMode) {
      const bounds = compact.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const clamped = clampToWorkArea(bounds, display.workArea);
      if (JSON.stringify(clamped) !== JSON.stringify(bounds)) {
        this._suppressSaves();
        compact.setBounds(clamped);
        this.scheduler.setBounds(this.compactMode, clamped);
      }
    }

    const board = this.board;
    if (board && !board.isDestroyed()) {
      const bounds = board.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const clamped = clampToWorkArea(bounds, display.workArea);
      if (JSON.stringify(clamped) !== JSON.stringify(bounds)) {
        this._suppressSaves();
        board.setBounds(clamped);
        this.scheduler.setBounds('board', clamped);
      }
    }
  }

  flushBounds() {
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
    if (this.compact && !this.compact.isDestroyed() && this.compactMode) {
      this.scheduler.setBounds(this.compactMode, this.compact.getBounds());
    }
    if (this.board && !this.board.isDestroyed()) {
      this.scheduler.setBounds('board', this.board.getBounds());
    }
  }

  destroy() {
    this.destroying = true;
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
    screen.removeListener('display-removed', this.onDisplayChanged);
    screen.removeListener('display-metrics-changed', this.onDisplayChanged);
    if (this.compact && !this.compact.isDestroyed()) this.compact.destroy();
    if (this.board && !this.board.isDestroyed()) this.board.destroy();
    this.compact = null;
    this.board = null;
  }
}

module.exports = {
  BOARD_MIN_SIZE,
  BOARD_SIZE,
  ORB_SIZE,
  WIDGET_SIZE,
  WindowManager,
};

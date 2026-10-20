'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  dialog,
  powerMonitor,
} = require('electron');
const { DISPLAY_MODES } = require('../shared/defaults');
const { registerIpc } = require('./ipc');
const { ReminderController } = require('./reminder');
const { SchedulerService } = require('./scheduler');
const { JsonStore } = require('./store');
const { TrayController } = require('./tray');
const { WindowManager } = require('./windows');

const APP_ID = 'com.standreminder.app';
const AUTOSTART_ARG = '--autostart';
const TEST_MODE = process.env.SR_TEST === '1' && !app.isPackaged;

app.setName('起身助手');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const userDataPath =
  TEST_MODE && process.env.SR_USER_DATA
    ? path.resolve(process.env.SR_USER_DATA)
    : path.join(app.getPath('appData'), 'StandReminder');
app.setPath('userData', userDataPath);

let scheduler = null;
let windows = null;
let reminder = null;
let tray = null;
let disposeIpc = null;
let powerHandlers = [];
let shuttingDown = false;
let cleanupDone = false;
let isAutostart = false;

function logError(label, error) {
  console.error(`[stand-reminder] ${label}:`, error);
}

function resourcePath(name) {
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, '..', '..', 'build', name);
}

function testDurations() {
  if (!TEST_MODE) return null;
  const sitMs = Number(process.env.SR_SIT_MS);
  const breakMs = Number(process.env.SR_BREAK_MS);
  return {
    sitMs: Number.isFinite(sitMs) && sitMs >= 1000 ? sitMs : 6000,
    breakMs: Number.isFinite(breakMs) && breakMs >= 1000 ? breakMs : 6000,
  };
}

function syncLoginItem(enabled) {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: [AUTOSTART_ARG],
      name: 'StandReminder',
    });
  } catch (error) {
    logError('更新开机自启失败', error);
  }
}

function safeDispatch(action) {
  try {
    scheduler.dispatch(action);
  } catch (error) {
    logError('操作失败', error);
  }
}

async function setDisplayMode(mode) {
  if (!DISPLAY_MODES.includes(mode)) return;
  const snapshot = scheduler.getSnapshot();
  if (snapshot.settings.displayMode === mode) {
    if (mode === 'board') {
      await windows.openBoard('overview', { focus: true });
    } else if (mode === 'widget' || mode === 'orb') {
      await windows.ensureCompact(mode);
    } else {
      windows.hideCompact();
      windows.hideBoard();
    }
    return;
  }
  scheduler.updateSettings({ ...snapshot.settings, displayMode: mode });
}

function removePowerHandlers() {
  if (!powerMonitor || powerHandlers.length === 0) return;
  for (const [event, handler] of powerHandlers) {
    try {
      powerMonitor.removeListener(event, handler);
    } catch {
      // Power monitoring can disappear during shutdown.
    }
  }
  powerHandlers = [];
}

function registerPowerHandlers() {
  const add = (event, handler) => {
    powerMonitor.on(event, handler);
    powerHandlers.push([event, handler]);
  };
  add('lock-screen', () => {
    scheduler.setFrozen('lock', true);
    reminder.hide();
  });
  add('unlock-screen', () => {
    scheduler.setFrozen('lock', false);
  });
  add('suspend', () => {
    scheduler.setFrozen('sleep', true);
    reminder.hide();
  });
  add('resume', () => {
    scheduler.setFrozen('sleep', false);
  });
}

function registerSchedulerEvents() {
  scheduler.on('reminder', (payload) => {
    reminder.present(payload).catch((error) => logError('显示提醒失败', error));
  });
  scheduler.on('reminderEscalated', (payload) => {
    reminder.present(payload).catch((error) => logError('升级提醒失败', error));
  });
  scheduler.on('dismissReminder', () => reminder.hide());
  scheduler.on('snapshot', (snapshot) => {
    windows.sendSnapshot(snapshot);
    tray.update(snapshot);
  });
  scheduler.on('settingsChanged', ({ previous, current }) => {
    if (previous.autoStart !== current.autoStart) {
      syncLoginItem(current.autoStart);
    }
    if (previous.boardAlwaysOnTop !== current.boardAlwaysOnTop) {
      windows.applyBoardAlwaysOnTop();
    }
    if (previous.displayMode !== current.displayMode) {
      windows
        .applyDisplayMode(current.displayMode, {
          focus: current.displayMode === 'board',
        })
        .catch((error) => logError('切换显示模式失败', error));
    }
  });
  scheduler.on('persistError', (error) => logError('保存数据失败', error));
}

async function bootstrap() {
  isAutostart = process.argv.includes(AUTOSTART_ARG);

  const srcRoot = path.join(__dirname, '..');
  const rendererRoot = path.join(srcRoot, 'renderer');
  const preloadPath = path.join(srcRoot, 'preload', 'preload.js');
  const iconPath = resourcePath('icon.png');
  const trayIconPath = fs.existsSync(resourcePath('tray.png'))
    ? resourcePath('tray.png')
    : iconPath;

  const store = new JsonStore(path.join(app.getPath('userData'), 'store.json'));
  scheduler = new SchedulerService({
    store,
    durations: testDurations(),
    meta: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      autoStartSupported: app.isPackaged && process.platform === 'win32',
      testMode: TEST_MODE,
    },
  });

  windows = new WindowManager({
    preloadPath,
    compactPage: path.join(rendererRoot, 'compact', 'index.html'),
    boardPage: path.join(rendererRoot, 'board', 'index.html'),
    iconPath,
    scheduler,
    isQuitting: () => shuttingDown,
  });

  reminder = new ReminderController({
    preloadPath,
    pagePath: path.join(rendererRoot, 'reminder', 'index.html'),
    iconPath,
    scheduler,
    isQuitting: () => shuttingDown,
  });

  tray = new TrayController({
    iconPath: trayIconPath,
    scheduler,
    windows,
    actions: {
      openBoard: (tab) => windows.openBoard(tab, { focus: true }),
      setDisplayMode,
      pause: (mode) => safeDispatch({ type: 'pause', mode }),
      resume: () => safeDispatch({ type: 'resume' }),
      quit: () => app.quit(),
    },
  });

  registerSchedulerEvents();
  disposeIpc = registerIpc({
    scheduler,
    windows,
    rendererRoot,
  });
  registerPowerHandlers();
  tray.create();
  syncLoginItem(scheduler.settings.autoStart);

  await windows.applyDisplayMode(scheduler.settings.displayMode, {
    focus: !isAutostart && scheduler.settings.displayMode === 'board',
  });
  scheduler.start();
}

function fatalStartup(error) {
  logError('启动失败', error);
  try {
    dialog.showErrorBox(
      '起身助手无法启动',
      error && error.message ? error.message : '发生未知错误。',
    );
  } catch {
    // Ignore dialog failures during startup.
  }
  app.quit();
}

function cleanupBeforeQuit() {
  if (cleanupDone) return;
  cleanupDone = true;
  shuttingDown = true;
  removePowerHandlers();
  if (disposeIpc) {
    try {
      disposeIpc();
    } catch (error) {
      logError('注销 IPC 失败', error);
    }
    disposeIpc = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (reminder) {
    try {
      reminder.flushBounds();
      reminder.destroy();
    } catch (error) {
      logError('关闭提醒窗口失败', error);
    }
    reminder = null;
  }
  if (windows) {
    try {
      windows.flushBounds();
      windows.destroy();
    } catch (error) {
      logError('关闭窗口失败', error);
    }
    windows = null;
  }
  if (scheduler) {
    try {
      scheduler.shutdown();
    } catch (error) {
      logError('保存数据失败', error);
    }
    scheduler = null;
  }
}

const hasSingleInstanceLock = TEST_MODE ? true : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!windows || shuttingDown) return;
    windows.openBoard('overview', { focus: true }).catch((error) => {
      logError('打开看板失败', error);
    });
  });

  app.on('activate', () => {
    if (!windows || shuttingDown) return;
    windows.openBoard('overview', { focus: true }).catch(() => {});
  });

  app.on('window-all-closed', () => {
    // Keep the reminder alive in the system tray.
  });

  app.on('before-quit', cleanupBeforeQuit);

  app.whenReady().then(bootstrap).catch(fatalStartup);
}

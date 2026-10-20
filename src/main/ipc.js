'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ipcMain } = require('electron');

const HANDLED_CHANNELS = [
  'sr:get-snapshot',
  'sr:action',
  'sr:update-settings',
  'sr:clear-stats',
  'sr:open-board',
  'sr:close-board',
  'sr:minimize-board',
];

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;
  if (raw.type === 'snooze') {
    const minutes = Number(raw.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return null;
    return { type: 'snooze', minutes };
  }
  if (raw.type === 'pause') {
    if (raw.mode !== 30 && raw.mode !== 60 && raw.mode !== 'today') return null;
    return { type: 'pause', mode: raw.mode };
  }
  if (raw.type === 'startBreak' || raw.type === 'finishBreak' || raw.type === 'resume') {
    return { type: raw.type };
  }
  return null;
}

function trustedSender(event, rendererPrefix) {
  try {
    if (!event.senderFrame || event.senderFrame.parent) return false;
    const frameUrl = event.senderFrame.url;
    const senderUrl = event.sender.getURL();
    return frameUrl.startsWith(rendererPrefix) && senderUrl.startsWith(rendererPrefix);
  } catch {
    return false;
  }
}

function registerIpc({ scheduler, windows, rendererRoot }) {
  const rendererPrefix = pathToFileURL(`${rendererRoot}${path.sep}`).href;

  const handle = (channel, callback) => {
    ipcMain.handle(channel, async (event, payload) => {
      if (!trustedSender(event, rendererPrefix)) {
        return { ok: false, error: '请求来源无效' };
      }
      try {
        const snapshot = await callback(payload);
        return snapshot === undefined ? { ok: true } : { ok: true, snapshot };
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : '操作失败',
        };
      }
    });
  };

  handle('sr:get-snapshot', () => scheduler.getSnapshot());

  handle('sr:action', (payload) => {
    const action = normalizeAction(payload);
    if (!action) throw new Error('无效的操作');
    return scheduler.dispatch(action);
  });

  handle('sr:update-settings', (payload) => scheduler.updateSettings(payload));

  handle('sr:clear-stats', () => scheduler.clearStats());

  handle('sr:open-board', async (payload) => {
    const tab = payload && payload.tab === 'settings' ? 'settings' : 'overview';
    await windows.openBoard(tab, { focus: true });
  });

  handle('sr:close-board', () => {
    windows.hideBoard();
  });

  handle('sr:minimize-board', () => {
    windows.minimizeBoard();
  });

  return () => {
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel);
  };
}

module.exports = {
  HANDLED_CHANNELS,
  normalizeAction,
  registerIpc,
  trustedSender,
};

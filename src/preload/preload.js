'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    throw new Error(response && response.error ? response.error : '操作失败');
  }
  return response.snapshot === undefined ? null : response.snapshot;
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  getSnapshot: () => invoke('sr:get-snapshot'),
  action: (type, options = {}) =>
    invoke('sr:action', {
      type,
      minutes: options.minutes,
      mode: options.mode,
    }),
  snooze: (minutes) => invoke('sr:action', { type: 'snooze', minutes }),
  startBreak: () => invoke('sr:action', { type: 'startBreak' }),
  finishBreak: () => invoke('sr:action', { type: 'finishBreak' }),
  pause: (mode) => invoke('sr:action', { type: 'pause', mode }),
  resume: () => invoke('sr:action', { type: 'resume' }),
  updateSettings: (settings) => invoke('sr:update-settings', settings),
  clearStats: () => invoke('sr:clear-stats'),
  openBoard: (tab = 'overview') => invoke('sr:open-board', { tab }),
  closeBoard: () => invoke('sr:close-board'),
  minimizeBoard: () => invoke('sr:minimize-board'),
  onSnapshot: (callback) => subscribe('sr:snapshot', callback),
  onReminder: (callback) => subscribe('sr:reminder-data', callback),
  onNavigate: (callback) => subscribe('sr:navigate', callback),
};

contextBridge.exposeInMainWorld('sr', Object.freeze(api));

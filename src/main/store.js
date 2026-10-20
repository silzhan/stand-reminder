'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createDefaultSettings,
  normalizeLoadedSettings,
} = require('../shared/defaults');
const { normalizeStats } = require('../shared/stats');

const SCHEMA_VERSION = 1;

function defaultData(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: createDefaultSettings(),
    stats: normalizeStats({}, now),
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load(now = Date.now()) {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return defaultData(now);
      throw error;
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        schemaVersion: SCHEMA_VERSION,
        settings: normalizeLoadedSettings(parsed && parsed.settings),
        stats: normalizeStats(parsed && parsed.stats, now),
      };
    } catch {
      this._backupCorrupt();
      return defaultData(now);
    }
  }

  _backupCorrupt() {
    try {
      const backup = `${this.filePath}.bad-${Date.now()}`;
      fs.renameSync(this.filePath, backup);
    } catch {
      // A failed backup must not prevent the app from starting.
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const serialized = `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        settings: data.settings,
        stats: data.stats,
      },
      null,
      2,
    )}\n`;
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, serialized, 'utf8');
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        fs.writeFileSync(this.filePath, serialized, 'utf8');
      } finally {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore temp cleanup failure.
        }
      }
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    }
  }
}

module.exports = {
  SCHEMA_VERSION,
  JsonStore,
  defaultData,
};

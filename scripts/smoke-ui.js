'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'artifacts', 'smoke');
const SIT_MS = 5000;
const BREAK_MS = 5000;
const PAGE_TIMEOUT_MS = 25000;
const PHASE_TIMEOUT_MS = 25000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(label, timeoutMs, check, intervalMs = 250) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();

    ws.addEventListener('message', (event) => {
      let message;
      try {
        const raw =
          typeof event.data === 'string'
            ? event.data
            : Buffer.from(event.data).toString('utf8');
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(message.error.message || 'CDP 调用失败'));
      } else {
        resolve(message.result);
      }
    });

    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('调试连接已关闭'));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const onError = () => {
        ws.removeEventListener('open', onOpen);
        reject(new Error('无法连接调试端口'));
      };
      const onOpen = () => {
        ws.removeEventListener('error', onError);
        resolve(new CdpClient(ws));
      };
      ws.addEventListener('error', onError);
      ws.addEventListener('open', onOpen);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore close failures during teardown.
    }
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const description =
      (details.exception && details.exception.description) ||
      details.text ||
      '页面脚本执行失败';
    throw new Error(description);
  }
  return result.result ? result.result.value : undefined;
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`调试接口返回 ${response.status}`);
  return response.json();
}

async function captureScreenshot(client, name) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(ARTIFACTS, name);
  await fsp.writeFile(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function connectToPage(port, fragment, isAlive) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < PAGE_TIMEOUT_MS) {
    if (!isAlive()) throw new Error('Electron 已提前退出，无法连接页面');
    try {
      const targets = await listTargets(port);
      const target = targets.find(
        (item) => item.type === 'page' && item.url.includes(fragment),
      );
      if (target) {
        const client = await CdpClient.connect(target.webSocketDebuggerUrl);
        await client.send('Runtime.enable');
        await client.send('Page.enable');
        if (await evaluate(client, 'Boolean(window.sr)')) {
          return { client, target };
        }
        client.close();
      }
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`等待页面 ${fragment} 超时${suffix}`);
}

async function phaseOf(compact) {
  return evaluate(
    compact,
    'window.sr.getSnapshot().then((snapshot) => snapshot.phase)',
  );
}

async function waitForPhase(compact, phases, label) {
  return waitFor(
    label,
    PHASE_TIMEOUT_MS,
    async () => {
      const phase = await phaseOf(compact);
      return phases.includes(phase) ? phase : null;
    },
    300,
  );
}

async function setActiveTestSchedule(compact) {
  await evaluate(
    compact,
    `(async () => {
      const snapshot = await window.sr.getSnapshot();
      await window.sr.updateSettings({
        displayMode: snapshot.settings.displayMode,
        autoStart: false,
        soundEnabled: false,
        boardAlwaysOnTop: false,
        schedule: {
          workdays: [0, 1, 2, 3, 4, 5, 6],
          workStart: '00:00',
          workEnd: '23:59',
          lunchEnabled: false,
          lunchStart: '12:00',
          lunchEnd: '13:30',
        },
        rhythm: snapshot.settings.rhythm,
      });
      return true;
    })()`,
  );
}

async function switchDisplayMode(compact, mode) {
  await evaluate(
    compact,
    `(async () => {
      const snapshot = await window.sr.getSnapshot();
      await window.sr.updateSettings({ ...snapshot.settings, displayMode: '${mode}' });
      return true;
    })()`,
  );
  await waitFor(
    `display mode ${mode}`,
    5000,
    async () => (await evaluate(compact, 'document.body.dataset.mode')) === mode,
  );
}

async function main() {
  await fsp.mkdir(ARTIFACTS, { recursive: true });
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'stand-reminder-smoke-'));
  const logPath = path.join(ARTIFACTS, 'electron.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const debugPort = await getFreePort();
  const electronPath = require('electron');
  const screenshots = [];
  const clients = [];
  let child = null;
  let exited = null;
  let succeeded = false;

  const isAlive = () => exited === null;

  try {
    const args = [
      ROOT,
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
    ];
    child = spawn(electronPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        SR_TEST: '1',
        SR_USER_DATA: userDataDir,
        SR_SIT_MS: String(SIT_MS),
        SR_BREAK_MS: String(BREAK_MS),
        ELECTRON_ENABLE_LOGGING: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on('exit', (code, signal) => {
      exited = { code, signal };
    });

    console.log(`Electron debug port: ${debugPort}`);
    console.log(`User data: ${userDataDir}`);

    const compactConnection = await connectToPage(
      debugPort,
      '/compact/index.html',
      isAlive,
    );
    const compact = compactConnection.client;
    clients.push(compact);
    await waitFor(
      'compact renderer ready',
      8000,
      async () => (await evaluate(compact, 'document.body.dataset.mode')) === 'widget',
    );

    await setActiveTestSchedule(compact);
    await waitForPhase(compact, ['SITTING'], 'sitting cycle');
    await delay(400);
    screenshots.push(await captureScreenshot(compact, 'widget.png'));
    console.log('PASS widget screenshot');

    await switchDisplayMode(compact, 'orb');
    await delay(500);
    screenshots.push(await captureScreenshot(compact, 'orb.png'));
    console.log('PASS orb screenshot');

    await switchDisplayMode(compact, 'widget');
    await evaluate(compact, "window.sr.openBoard('overview')");
    const boardConnection = await connectToPage(
      debugPort,
      '/board/index.html',
      isAlive,
    );
    const board = boardConnection.client;
    clients.push(board);
    await delay(900);
    screenshots.push(await captureScreenshot(board, 'board-overview.png'));
    await evaluate(board, "document.getElementById('tab-settings').click()");
    await delay(500);
    screenshots.push(await captureScreenshot(board, 'board-settings.png'));
    await evaluate(board, 'window.sr.closeBoard()');
    console.log('PASS board screenshots');

    const phase = await waitForPhase(compact, ['REMINDER'], 'reminder');
    assert.equal(phase, 'REMINDER');

    const reminderConnection = await connectToPage(
      debugPort,
      '/reminder/index.html',
      isAlive,
    );
    const reminder = reminderConnection.client;
    clients.push(reminder);
    await waitFor(
      'reminder content',
      8000,
      async () =>
        (await evaluate(reminder, 'document.body.dataset.level')) !== undefined,
    );
    await delay(400);
    screenshots.push(await captureScreenshot(reminder, 'reminder.png'));
    console.log('PASS reminder screenshot');

    await evaluate(reminder, "document.getElementById('snooze-5').click()");
    await waitForPhase(compact, ['SNOOZED'], 'snoozed');
    console.log('PASS snooze 5 minutes');

    await evaluate(compact, "window.sr.pause('today')");
    await waitForPhase(compact, ['PAUSED'], 'paused');
    await evaluate(compact, 'window.sr.resume()');
    await waitForPhase(compact, ['SITTING'], 'resumed sitting');

    await waitForPhase(compact, ['REMINDER'], 'second reminder');
    await delay(400);
    await evaluate(reminder, "document.getElementById('start-break').click()");
    await waitForPhase(compact, ['BREAK'], 'break started');
    await waitForPhase(compact, ['SITTING'], 'break completed');
    console.log('PASS pause/resume and full break');

    const today = await evaluate(
      compact,
      'window.sr.getSnapshot().then((snapshot) => snapshot.stats.today)',
    );
    assert.ok(today.remindersShown >= 2, 'expected at least two reminders');
    assert.ok(today.snoozes >= 1, 'expected at least one snooze');
    assert.ok(today.breaksStarted >= 1, 'expected at least one break');
    assert.ok(today.breaksCompleted >= 1, 'expected a completed break');
    assert.ok(today.sittingMs > 0, 'expected recorded sitting time');

    const store = JSON.parse(
      await fsp.readFile(path.join(userDataDir, 'store.json'), 'utf8'),
    );
    assert.equal(store.schemaVersion, 1);
    assert.equal(store.settings.soundEnabled, false);
    assert.deepEqual(store.settings.schedule.workdays, [0, 1, 2, 3, 4, 5, 6]);
    const storedKeys = Object.keys(store.stats);
    assert.ok(storedKeys.length > 0, 'expected persisted statistics');
    assert.ok(store.stats[storedKeys[0]].breaksCompleted >= 1);
    console.log('PASS persisted statistics');

    succeeded = true;
    console.log('');
    console.log('Smoke flow complete.');
    for (const file of screenshots) {
      console.log(`  screenshot: ${path.relative(ROOT, file)}`);
    }
    console.log(`  electron log: ${path.relative(ROOT, logPath)}`);
    console.log(`  statistics: ${JSON.stringify(today)}`);
  } finally {
    for (const client of clients) client.close();
    if (child && !exited) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => {
          if (exited) resolve();
          else child.once('exit', resolve);
        }),
        delay(5000),
      ]);
      if (!exited) child.kill('SIGKILL');
    }
    logStream.end();
    if (!succeeded) {
      console.error(`Smoke failed. User data kept at ${userDataDir}`);
      try {
        const log = await fsp.readFile(logPath, 'utf8');
        if (log.trim()) console.error(log.split('\n').slice(-30).join('\n'));
      } catch {
        // Log file may not exist yet.
      }
    } else {
      await delay(300);
      await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

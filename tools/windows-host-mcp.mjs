import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const config = JSON.parse(await readFile(new URL('../.ps5-windows-mcp.json', import.meta.url), 'utf8'));
if (!config.token || !config.adminUserId) throw new Error('Missing private MCP configuration');
const port = 8766;
const app = createMcpExpressApp({ allowedHosts: ['127.0.0.1', 'localhost', 'host.docker.internal'] });
const screenScript = fileURLToPath(new URL('./windows-screen.py', import.meta.url));
const screenPausedFile = fileURLToPath(new URL('../.ps5-screen-paused', import.meta.url));
let overlayProcess;
let overlayTimer;
let lastScreen;
let lastTargetHandle;
let screenQueue = Promise.resolve();

function withScreenLock(operation) {
  const run = screenQueue.then(operation);
  screenQueue = run.catch(() => {});
  return run;
}

function endScreenControl() {
  clearTimeout(overlayTimer);
  if (overlayProcess && overlayProcess.exitCode === null) overlayProcess.kill();
  overlayProcess = undefined;
  lastScreen = undefined;
  lastTargetHandle = undefined;
}

function requireScreenEnabled() {
  if (existsSync(screenPausedFile)) {
    lastScreen = undefined;
    lastTargetHandle = undefined;
    throw new Error('Screen control was stopped on the laptop. Use the Resume PS5 Screen Control desktop shortcut before trying again.');
  }
}

function keepScreenIndicatorVisible() {
  if (!overlayProcess || overlayProcess.exitCode !== null) {
    overlayProcess = spawn('python', [screenScript, 'overlay'], {
      windowsHide: true, stdio: 'ignore',
    });
    const currentOverlay = overlayProcess;
    overlayProcess.on('error', (error) => console.error('Screen indicator failed:', error.message));
    overlayProcess.on('exit', () => {
      if (overlayProcess === currentOverlay) {
        overlayProcess = undefined;
        lastScreen = undefined;
        lastTargetHandle = undefined;
      }
    });
  }
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(endScreenControl, 150_000);
}

function screenIsFresh() {
  requireScreenEnabled();
  if (!lastScreen || Date.now() - lastScreen.when > 120_000) {
    throw new Error('Take a fresh screen capture before clicking or typing');
  }
}

function screenPointIsVisible(x, y) {
  screenIsFresh();
  const { originX, originY, width, height } = lastScreen;
  if (x < originX || y < originY || x >= originX + width || y >= originY + height) {
    throw new Error('Screen coordinates are outside the most recent capture');
  }
}

async function runScreenProcess(request) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('python', [screenScript], { windowsHide: true, timeout: 30_000 });
    let output = '';
    let errors = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
      if (output.length > 25_000_000) child.kill();
    });
    child.stderr.on('data', (data) => { errors = (errors + data.toString()).slice(0, 2000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errors || output.slice(0, 500) || 'Screen action failed'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid screen response')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
  if (result.error) throw new Error(result.error);
  return result;
}

async function runScreenAction(request) {
  requireScreenEnabled();
  const result = await runScreenProcess(request);
  lastScreen = { originX: result.originX, originY: result.originY,
    width: result.width, height: result.height, windows: result.windows, when: Date.now() };
  if (request.action === 'click') lastTargetHandle = result.activeHandle;
  keepScreenIndicatorVisible();
  return { content: [
    { type: 'text', text: `Viewing monitor ${result.monitorIndex}; screen origin (${result.originX}, ${result.originY}); size ${result.width} × ${result.height}. ${result.movedFromMonitor == null ? '' : `Moved target here from monitor ${result.movedFromMonitor}. `}Foreground window: ${result.foregroundWindow}. Coordinates are absolute Windows desktop pixels. OCR text and window/control rectangles: ${JSON.stringify({ text: result.text, windows: result.windows, otherMonitorWindows: result.otherMonitorWindows })}` },
  ] };
}

function sameSecret(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createServer(adminRequest) {
  const server = new McpServer({ name: 'ps5-windows-host', version: '1.0.0' });
  const authorize = () => {
    if (!adminRequest) throw new Error('This tool is available only to the private admin agent');
  };
  server.registerTool('list_directory', {
    description: 'List files and folders at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1) },
  }, async ({ path }) => {
    authorize();
    const entries = await readdir(path, { withFileTypes: true });
    return { content: [{ type: 'text', text: entries.slice(0, 500).map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n') || '(empty)' }] };
  });
  server.registerTool('read_text_file', {
    description: 'Read a UTF-8 text file at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1) },
  }, async ({ path }) => {
    authorize();
    const contents = await readFile(path, 'utf8');
    return { content: [{ type: 'text', text: contents.slice(0, 100_000) }] };
  });
  server.registerTool('write_text_file', {
    description: 'Create or replace a UTF-8 text file at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1), content: z.string() },
  }, async ({ path, content }) => {
    authorize();
    await writeFile(path, content, 'utf8');
    return { content: [{ type: 'text', text: `Wrote ${path}` }] };
  });
  server.registerTool('run_powershell', {
    description: 'Run a PowerShell command on the host Windows laptop as the signed-in Windows user. Commands run automatically.',
    inputSchema: { command: z.string().min(1).max(8000) },
  }, async ({ command }) => {
    authorize();
    const result = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, shell: false, timeout: 60_000,
      });
      let output = '';
      child.stdout.on('data', (data) => { output = (output + data.toString()).slice(0, 100_000); });
      child.stderr.on('data', (data) => { output = (output + data.toString()).slice(0, 100_000); });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve(`Exit code: ${code ?? signal}\n${output}`));
    });
    return { content: [{ type: 'text', text: result }] };
  });
  server.registerTool('screen_capture', {
    description: 'Read OCR text and window/control rectangles. Call screen_monitors to find an app title. With activate_window_title, restore and bring the window in front, moving it to the requested monitor (primary monitor by default) before capture. Set move_to_capture_monitor=false to keep it on its current monitor. Other-monitor window titles are included. Starts visible control banners.',
    inputSchema: { scope: z.enum(['primary', 'all']).default('primary'),
      monitor: z.number().int().min(0).optional(),
      activate_window_title: z.string().min(1).optional(),
      move_to_capture_monitor: z.boolean().default(true),
      region: z.object({ x: z.number().int(), y: z.number().int(),
        width: z.number().int().min(1), height: z.number().int().min(1) }).optional() },
  }, async ({ scope, monitor, region, activate_window_title, move_to_capture_monitor }) => {
    authorize();
    return withScreenLock(() => {
      if (activate_window_title) {
        requireScreenEnabled();
        keepScreenIndicatorVisible();
      }
      return runScreenAction({ action: 'capture', scope, monitor, region, activate_window_title, move_to_capture_monitor });
    });
  });
  server.registerTool('screen_monitors', {
    description: 'List connected monitors and visible window titles with each window’s monitor index, minimized status, and foreground status. Use this to find where a newly opened app landed. Does not take a screenshot.',
    inputSchema: {},
  }, async () => {
    authorize();
    const result = await runScreenProcess({ action: 'monitors' });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
  server.registerTool('screen_click', {
    description: 'Click within a named window at absolute desktop coordinates from a recent capture. Give the exact window_title shown by capture. Restores and foregrounds that window, verifies it is visibly at the click point, then clicks. Refuses if another window covers it.',
    inputSchema: { window_title: z.string().min(1), x: z.number().int(), y: z.number().int(),
      button: z.enum(['left', 'right']).default('left'), count: z.number().int().min(1).max(2).default(1) },
  }, async ({ window_title, x, y, button, count }) => {
    authorize();
    return withScreenLock(() => {
      screenPointIsVisible(x, y);
      keepScreenIndicatorVisible();
      return runScreenAction({ action: 'click', window_title, x, y, button, count,
        region: { x: lastScreen.originX, y: lastScreen.originY,
          width: lastScreen.width, height: lastScreen.height } });
    });
  });
  server.registerTool('screen_type', {
    description: 'Type text after screen_click has focused the intended window. Refuses if another window has taken focus. Returns refreshed OCR and window positions.',
    inputSchema: { text: z.string().min(1).max(500) },
  }, async ({ text }) => {
    authorize();
    return withScreenLock(() => {
      screenIsFresh();
      if (!lastTargetHandle) throw new Error('Click the intended named window before typing');
      keepScreenIndicatorVisible();
      return runScreenAction({ action: 'type', text, expectedHandle: lastTargetHandle,
        region: { x: lastScreen.originX, y: lastScreen.originY,
          width: lastScreen.width, height: lastScreen.height } });
    });
  });
  server.registerTool('screen_key', {
    description: 'Press a key or shortcut in the window focused by screen_click. Refuses if another window has taken focus. Supports Enter, Escape, Ctrl+A, Alt+Tab, and similar keys.',
    inputSchema: { keys: z.string().min(1).max(40) },
  }, async ({ keys }) => {
    authorize();
    return withScreenLock(() => {
      screenIsFresh();
      if (!lastTargetHandle) throw new Error('Click the intended named window before pressing keys');
      keepScreenIndicatorVisible();
      return runScreenAction({ action: 'key', keys, expectedHandle: lastTargetHandle,
        region: { x: lastScreen.originX, y: lastScreen.originY,
          width: lastScreen.width, height: lastScreen.height } });
    });
  });
  server.registerTool('screen_scroll', {
    description: 'Scroll at absolute desktop coordinates; positive steps scroll up, negative steps scroll down. Returns a new screenshot.',
    inputSchema: { x: z.number().int(), y: z.number().int(), steps: z.number().int().min(-10).max(10) },
  }, async ({ x, y, steps }) => {
    authorize();
    return withScreenLock(() => {
      screenPointIsVisible(x, y);
      if (!lastTargetHandle) throw new Error('Click the intended named window before scrolling');
      keepScreenIndicatorVisible();
      return runScreenAction({ action: 'scroll', x, y, steps, expectedHandle: lastTargetHandle,
        region: { x: lastScreen.originX, y: lastScreen.originY,
          width: lastScreen.width, height: lastScreen.height } });
    });
  });
  server.registerTool('screen_control_end', {
    description: 'End the screen-control session and remove the visible indicator.',
    inputSchema: {},
  }, async () => {
    authorize();
    return withScreenLock(() => {
      endScreenControl();
      return { content: [{ type: 'text', text: 'Screen control ended' }] };
    });
  });
  return server;
}

app.post('/mcp', async (req, res) => {
  if (!sameSecret(req.get('X-API-Key'), config.token)) return res.sendStatus(401);
  const adminRequest = req.get('X-LibreChat-User-Id') === config.adminUserId;
  if (req.body?.method === 'tools/call' && !adminRequest) return res.sendStatus(403);
  const server = createServer(adminRequest);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.sendStatus(500);
  }
});
app.get('/mcp', (_req, res) => res.sendStatus(405));
app.delete('/mcp', (_req, res) => res.sendStatus(405));
app.listen(port, '127.0.0.1', () => console.log(`Private Windows MCP listening on 127.0.0.1:${port}`));

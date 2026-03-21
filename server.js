import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { execSync, execFileSync } from 'child_process';
import pty from 'node-pty';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SHELL = process.env.SHELL || '/bin/zsh';

const TMUX = (() => {
  try { return execSync('which tmux').toString().trim(); }
  catch { return null; }
})();

const app = express();
app.use(express.static(resolve(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');

  if (AUTH_TOKEN && token !== AUTH_TOKEN) {
    console.log(`[WS] Rejected connection — invalid token from ${req.socket.remoteAddress}`);
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const ptyProcess = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: { ...process.env, TERMTUNNEL: '1' },
  });

  // Attach to (or create) persistent tmux session
  if (TMUX) {
    ptyProcess.write(`exec ${TMUX} new-session -A -s termtunnel -e TERMTUNNEL=1\r`);
  }

  send({ type: 'status', data: 'connected' });

  // Buffer PTY output and flush every 16ms to reduce WebSocket message rate
  let outputBuf = '';
  let flushTimer = null;
  function flushOutput() {
    flushTimer = null;
    if (outputBuf) {
      send({ type: 'data', data: Buffer.from(outputBuf).toString('base64') });
      outputBuf = '';
    }
  }
  ptyProcess.onData((data) => {
    outputBuf += data;
    if (!flushTimer) flushTimer = setTimeout(flushOutput, 16);
  });

  ptyProcess.onExit(() => {
    console.log('[PTY] Process exited');
    send({ type: 'status', data: 'disconnected' });
    ws.close();
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'data') {
      ptyProcess.write(Buffer.from(msg.data, 'base64').toString());
    } else if (msg.type === 'resize') {
      ptyProcess.resize(msg.cols, msg.rows);
    }
  });

  ws.on('close', (code) => {
    console.log(`[WS] Client disconnected (${code})`);
    clearTimeout(flushTimer);
    ptyProcess.kill();
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});


server.listen(PORT, () => {
  console.log(`[TermTunnel] Server listening on http://localhost:${PORT}`);
  console.log(`[TermTunnel] Shell: ${SHELL}`);
  console.log(`[TermTunnel] Auth token: ${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(none — open access)'}`);
  console.log(`[TermTunnel] Session persistence: ${TMUX ? `tmux at ${TMUX}` : 'none (tmux not found)'}`);
});

function checkForUpdates() {
  try {
    const before = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
    execFileSync('git', ['pull', '--quiet'], { cwd: __dirname });
    const after = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
    if (before !== after) {
      console.log('[AutoUpdate] New version pulled — restarting…');
      process.exit(0);
    }
  } catch (err) {
    console.error('[AutoUpdate] git pull failed:', err.message);
  }
}

setInterval(checkForUpdates, 15 * 60 * 1000);

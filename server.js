import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { execSync, exec } from 'child_process';
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

  ptyProcess.onData((data) => {
    send({ type: 'data', data: Buffer.from(data).toString('base64') });
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
    ptyProcess.kill();
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

function pullMain() {
  exec('git pull origin main', { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) {
      console.error('[AutoUpdate] git pull failed:', stderr.trim() || err.message);
      return;
    }
    const out = stdout.trim();
    if (out && out !== 'Already up to date.') {
      console.log('[AutoUpdate] Pulled changes:', out);
      console.log('[AutoUpdate] Restarting via pm2...');
      exec('pm2 restart termtunnel', (restartErr) => {
        if (restartErr) console.error('[AutoUpdate] pm2 restart failed:', restartErr.message);
      });
    }
  });
}

setInterval(pullMain, 15 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`[TermTunnel] Server listening on http://localhost:${PORT}`);
  console.log(`[TermTunnel] Shell: ${SHELL}`);
  console.log(`[TermTunnel] Auth token: ${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(none — open access)'}`);
  console.log(`[TermTunnel] Session persistence: ${TMUX ? `tmux at ${TMUX}` : 'none (tmux not found)'}`);
});

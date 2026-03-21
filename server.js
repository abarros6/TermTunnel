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

async function probeTermTunnel(ip, port = PORT) {
  try {
    const r = await fetch(`http://${ip}:${port}/health`, {
      signal: AbortSignal.timeout(600),
    });
    return r.ok;
  } catch {
    return false;
  }
}

app.get('/api/peers', async (_req, res) => {
  try {
    const raw = execSync('tailscale status --json 2>/dev/null').toString();
    const status = JSON.parse(raw);
    const candidates = [];
    if (status.Self) {
      candidates.push({ name: status.Self.HostName, ip: status.Self.TailscaleIPs?.[0], self: true });
    }
    for (const peer of Object.values(status.Peer || {})) {
      if (peer.Online) {
        candidates.push({ name: peer.HostName, ip: peer.TailscaleIPs?.[0], self: false });
      }
    }
    const results = await Promise.allSettled(
      candidates.map(p => probeTermTunnel(p.ip))
    );
    const peers = candidates.filter((_, i) => results[i].value === true);
    res.json({ peers });
  } catch {
    res.json({ peers: [] });
  }
});

app.get('/api/sessions', (_req, res) => {
  if (!TMUX) return res.json({ sessions: [] });
  try {
    const out = execSync(`${TMUX} list-sessions -F "#{session_name}" 2>/dev/null`).toString().trim();
    res.json({ sessions: out ? out.split('\n').filter(Boolean) : [] });
  } catch {
    res.json({ sessions: [] });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const sessionName = url.searchParams.get('session') || 'termtunnel';

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
    ptyProcess.write(`exec ${TMUX} new-session -A -s ${sessionName} -e TERMTUNNEL=1\r`);
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

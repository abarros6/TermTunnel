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

// Detect tmux prefix and key bindings. Falls back to C-b defaults.
const TMUX_KEYBINDS = (() => {
  // Convert a tmux key name to the actual bytes to send
  function keyChar(k) {
    const cx = k.match(/^C-(.+)$/i);
    if (cx) {
      const c = cx[1].toLowerCase();
      return c === 'space' ? '\x00' : String.fromCharCode(c.charCodeAt(0) - 96);
    }
    const mx = k.match(/^M-(.+)$/i);
    if (mx) return '\x1b' + mx[1];
    return { Space: ' ', Enter: '\r', Tab: '\t', Escape: '\x1b', BSpace: '\x7f' }[k] ?? k;
  }

  let pfx = '\x02'; // C-b default
  const kb = {
    prefix: pfx,
    newWindow: pfx + 'c',
    nextWindow: pfx + 'n',
    prevWindow: pfx + 'p',
    copyMode: pfx + '[',
    detach: pfx + 'd',
    zoom: pfx + 'z',
  };
  if (!TMUX) return kb;
  try {
    // Detect prefix key (handles C-x, plain chars like `, named keys)
    const prefixOut = execSync(`${TMUX} show-options -g prefix 2>/dev/null`).toString().trim();
    const pm = prefixOut.match(/^prefix\s+(.+)$/);
    if (pm) pfx = keyChar(pm[1].trim());
    kb.prefix = pfx;

    // Map tmux command → keybinds property (first match wins)
    const wanted = {
      'new-window':     'newWindow',
      'next-window':    'nextWindow',
      'previous-window':'prevWindow',
      'copy-mode':      'copyMode',
      'detach-client':  'detach',
      'resize-pane -Z': 'zoom',
    };
    const found = new Set();

    const keysOut = execSync(`${TMUX} list-keys -T prefix 2>/dev/null`).toString();
    for (const line of keysOut.split('\n')) {
      // handles optional -r flag: bind-key [-r] -T prefix <key> <cmd>
      const m = line.match(/^bind-key\s+(?:-r\s+)?-T\s+prefix\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const [, key, cmd] = m;
      for (const [tmuxCmd, prop] of Object.entries(wanted)) {
        if (!found.has(prop) && cmd.trim().startsWith(tmuxCmd)) {
          kb[prop] = pfx + keyChar(key);
          found.add(prop);
          break;
        }
      }
    }
  } catch {}
  console.log(`[TermTunnel] tmux prefix: ${JSON.stringify(kb.prefix)}, keybinds:`, Object.fromEntries(Object.entries(kb).map(([k,v]) => [k, JSON.stringify(v)])));
  return kb;
})();

const app = express();
app.use(express.static(resolve(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/version', (_req, res) => {
  try {
    const hash    = execSync('git rev-parse HEAD',            { cwd: __dirname }).toString().trim();
    const date    = execSync('git log -1 --format=%ci HEAD', { cwd: __dirname }).toString().trim();
    const branch  = execSync('git rev-parse --abbrev-ref HEAD', { cwd: __dirname }).toString().trim();
    res.json({ hash, shortHash: hash.slice(0, 7), date, branch });
  } catch {
    res.json({ hash: 'unknown', shortHash: 'unknown', date: null, branch: 'unknown' });
  }
});

app.get('/api/check-update', (_req, res) => {
  try {
    execFileSync('git', ['fetch', '--quiet'], { cwd: __dirname });
    const local  = execSync('git rev-parse HEAD',            { cwd: __dirname }).toString().trim();
    const remote = execSync('git rev-parse origin/master',   { cwd: __dirname }).toString().trim();
    if (local === remote) return res.json({ upToDate: true, behind: 0 });
    const behind = parseInt(
      execSync(`git rev-list --count HEAD..origin/master`, { cwd: __dirname }).toString().trim(), 10
    );
    const latestDate = execSync('git log -1 --format=%ci origin/master', { cwd: __dirname }).toString().trim();
    res.json({ upToDate: false, behind, latestHash: remote.slice(0, 7), latestDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const sessions = out ? out.split('\n').filter(s => s && !s.startsWith('tt_ph_')) : [];
    res.json({ sessions });
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

  // Attach to (or create) tmux session.
  // If the target session already exists, use a grouped session so the phone
  // gets its own terminal size and doesn't resize the original.
  let isGrouped = false;
  if (TMUX) {
    let tmuxCmd;
    try {
      execSync(`${TMUX} has-session -t "${sessionName}" 2>/dev/null`);
      // Session exists — mirror it via grouped session so the phone gets its own terminal size
      const phoneSession = `tt_ph_${sessionName}`;
      tmuxCmd = `exec ${TMUX} new-session -A -s "${phoneSession}" -t "${sessionName}" -e TERMTUNNEL=1\r`;
      isGrouped = true;
    } catch {
      // Session doesn't exist — create it fresh
      tmuxCmd = `exec ${TMUX} new-session -s "${sessionName}" -e TERMTUNNEL=1\r`;
    }
    ptyProcess.write(tmuxCmd);
  }

  send({ type: 'status', data: 'connected', keybinds: TMUX_KEYBINDS });

  // For grouped sessions, keep the active pane zoomed so the phone sees a
  // full-screen view. Re-check on every resize (keyboard open/close, orientation
  // change) since tmux may unzoom when the terminal dimensions change.
  // Cache isMultiPane after first successful check to avoid repeated list-panes.
  let isMultiPane = null; // null = unknown, true/false = cached

  function ensureZoomed() {
    if (!isGrouped || !TMUX) return;
    try {
      const phoneSession = `tt_ph_${sessionName}`;
      if (isMultiPane === null) {
        execSync(`${TMUX} has-session -t "${phoneSession}" 2>/dev/null`);
        const out = execSync(`${TMUX} list-panes -t "${phoneSession}" 2>/dev/null`).toString().trim();
        isMultiPane = out.split('\n').length > 1;
      }
      if (isMultiPane) {
        const zoomed = execSync(`${TMUX} display-message -t "${phoneSession}" -p "#{window_zoomed_flag}" 2>/dev/null`).toString().trim();
        if (zoomed !== '1') {
          execSync(`${TMUX} resize-pane -t "${phoneSession}" -Z 2>/dev/null`);
        }
      }
    } catch {
      isMultiPane = null; // session not ready yet, retry next resize
    }
  }

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
      ensureZoomed();
    }
  });

  ws.on('close', (code) => {
    console.log(`[WS] Client disconnected (${code})`);
    clearTimeout(flushTimer);
    ptyProcess.kill();
    // Restore the original session's zoom state if the phone left it zoomed
    if (TMUX) {
      try {
        const zoomed = execSync(`${TMUX} display-message -t "${sessionName}" -p "#{window_zoomed_flag}" 2>/dev/null`).toString().trim();
        if (zoomed === '1') {
          execSync(`${TMUX} resize-pane -t "${sessionName}" -Z 2>/dev/null`);
        }
      } catch {}
    }
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

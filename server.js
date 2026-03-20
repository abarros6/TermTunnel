import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Client } from 'ssh2';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const SSH_HOST = process.env.SSH_HOST || '127.0.0.1';
const SSH_PORT = parseInt(process.env.SSH_PORT || '22', 10);
const SSH_USER = process.env.SSH_USER || process.env.USER;
const SSH_KEY_PATH = process.env.SSH_KEY_PATH
  ? resolve(process.env.SSH_KEY_PATH.replace(/^~/, homedir()))
  : resolve(homedir(), '.ssh', 'id_ed25519');
const SSH_PASSWORD = process.env.SSH_PASSWORD;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

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
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  const ssh = new Client();
  let stream = null;
  let sshReady = false;

  // Build SSH auth options
  const authOptions = {
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
  };

  if (SSH_PASSWORD) {
    authOptions.password = SSH_PASSWORD;
  } else if (existsSync(SSH_KEY_PATH)) {
    authOptions.privateKey = readFileSync(SSH_KEY_PATH);
  } else {
    // Let ssh2 try agent or default key discovery
    console.log(`[SSH] Key not found at ${SSH_KEY_PATH}, attempting agent auth`);
    authOptions.agent = process.env.SSH_AUTH_SOCK;
  }

  ssh.on('ready', () => {
    console.log(`[SSH] Connected to ${SSH_HOST}:${SSH_PORT} as ${SSH_USER}`);
    sshReady = true;

    ssh.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, sh) => {
      if (err) {
        console.error('[SSH] Shell error:', err.message);
        send({ type: 'error', data: `Shell error: ${err.message}` });
        ws.close();
        return;
      }

      stream = sh;
      send({ type: 'status', data: 'connected' });

      stream.on('data', (data) => {
        send({ type: 'data', data: Buffer.from(data).toString('base64') });
      });

      stream.stderr.on('data', (data) => {
        send({ type: 'data', data: Buffer.from(data).toString('base64') });
      });

      stream.on('close', () => {
        console.log(`[SSH] Stream closed`);
        send({ type: 'status', data: 'disconnected' });
        ws.close();
      });
    });
  });

  ssh.on('error', (err) => {
    console.error('[SSH] Error:', err.message);
    send({ type: 'error', data: err.message });
    ws.close();
  });

  ssh.on('close', () => {
    if (sshReady) {
      console.log(`[SSH] Connection closed`);
    }
  });

  // Handle messages from client
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'data') {
      if (stream) {
        stream.write(Buffer.from(msg.data, 'base64'));
      }
    } else if (msg.type === 'resize') {
      if (stream) {
        stream.setWindow(msg.rows, msg.cols, 0, 0);
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Client disconnected (${code})`);
    if (stream) {
      stream.end();
      stream = null;
    }
    ssh.end();
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });

  // Initiate SSH connection
  try {
    ssh.connect(authOptions);
  } catch (err) {
    console.error('[SSH] Connect threw:', err.message);
    send({ type: 'error', data: err.message });
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`[TermTunnel] Server listening on http://localhost:${PORT}`);
  console.log(`[TermTunnel] SSH target: ${SSH_USER}@${SSH_HOST}:${SSH_PORT}`);
  console.log(`[TermTunnel] Auth token: ${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(none — open access)'}`);
});

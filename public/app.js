(() => {
  // ── State ────────────────────────────────────────────────
  let ws = null;
  let term = null;
  let fitAddon = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let wasConnected = false;   // tracks if we've ever reached 'connected' state
  const MAX_RECONNECT = 5;
  const RECONNECT_CAP = 15000;

  // ── Origin (PWA is per-machine; host/port come from window.location) ─────
  const ORIGIN_HOST = window.location.hostname;
  const ORIGIN_PORT = window.location.port || '3000';

  // ── Settings persistence ─────────────────────────────────
  const SETTINGS_KEY = 'termtunnel_settings';
  const CONN_KEY = 'termtunnel_conn';

  const defaultSettings = {
    fontSize: 14,
    scrollback: 2000,
    cursorStyle: 'block',
    autoReconnect: true,
    kbFontSize: 22,
  };

  function loadSettings() {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...defaultSettings }; }
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function loadConn() {
    try { return JSON.parse(localStorage.getItem(CONN_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveConn(c) {
    localStorage.setItem(CONN_KEY, JSON.stringify(c));
  }

  // ── Terminal init ─────────────────────────────────────────
  const settings = loadSettings();

  term = new Terminal({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: settings.cursorStyle,
    scrollback: settings.scrollback,
    allowProposedApi: true,
    theme: {
      background: '#0a0e14',
      foreground: '#b3b1ad',
      cursor: '#00ff9f',
      cursorAccent: '#0a0e14',
      selectionBackground: 'rgba(0,255,159,0.2)',
      black: '#0a0e14',
      red: '#ff4444',
      green: '#00ff9f',
      yellow: '#ffb454',
      blue: '#4d9de0',
      magenta: '#c397d8',
      cyan: '#5ccfe6',
      white: '#b3b1ad',
      brightBlack: '#4a5568',
      brightRed: '#ff6b6b',
      brightGreen: '#00ffb3',
      brightYellow: '#ffd580',
      brightBlue: '#6ab0f5',
      brightMagenta: '#d4aaff',
      brightCyan: '#7fe8f2',
      brightWhite: '#e8e6e3',
    },
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));

  // Suppress iOS native keyboard — we'll drive input from a custom keyboard
  const xtermTextarea = document.querySelector('.xterm-helper-textarea');
  if (xtermTextarea) xtermTextarea.setAttribute('inputmode', 'none');

  term.writeln('\x1b[32mTermTunnel\x1b[0m \x1b[2m— WebSocket SSH Bridge\x1b[0m');
  term.writeln('\x1b[2mEnter connection details to begin.\x1b[0m');
  term.writeln('');

  // ── Resize handling ───────────────────────────────────────
  let fitDebounce = null;
  function doFit() {
    try { fitAddon.fit(); } catch {}
    term.scrollToBottom();
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMsg({ type: 'resize', cols: term.cols, rows: term.rows });
    }
  }
  function scheduleFit() {
    clearTimeout(fitDebounce);
    fitDebounce = setTimeout(doFit, 50);
  }

  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(document.getElementById('terminal-wrap'));

  window.visualViewport?.addEventListener('resize', scheduleFit);
  window.addEventListener('resize', () => { invalidateKeyCache(); scheduleFit(); });

  // ── Terminal input → WebSocket ────────────────────────────
  term.onData((data) => {
    sendData(data);
  });

  function sendData(str) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMsg({ type: 'data', data: btoa(unescape(encodeURIComponent(str))) });
    }
  }

  function sendMsg(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // ── Status dot ───────────────────────────────────────────
  const dot = document.getElementById('status-dot');
  function setStatus(state) {
    dot.className = state || '';
  }

  // ── Scroll mode toggle ────────────────────────────────────
  let scrollMode = false;
  let keybinds = {}; // updated on connect from server
  const scrollBtn       = document.getElementById('scroll-btn');
  const scrollPill      = document.getElementById('scroll-pill');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');

  function applyKeybinds(kb) {
    keybinds = kb;
    document.querySelectorAll('[data-tmux-cmd]').forEach(el => {
      const seq = kb[el.dataset.tmuxCmd];
      if (seq !== undefined) el.dataset.send = seq;
    });
  }

  // ── Scroll pill interaction ───────────────────────────────
  // Uses tmux copy mode for scrolling — this gives access to tmux's full
  // scrollback history (term.scrollLines() only works in the normal screen
  // buffer, but tmux uses the alternate screen which has no scrollback).
  //
  // SCR on  → sends tmux prefix + [ to enter copy mode
  // pill    → sends arrow keys into copy mode at a rate driven by touch position
  // SCR off → sends q to exit copy mode
  //
  // Continuous accumulator: quadratic speed curve, slow near center, fast at edges.
  const SP_MAX_RATE = 0.55; // scroll lines per 16ms tick at full deflection

  let spTicker = null;
  let spTouchY = null;
  let spAccum  = 0;

  function spTick() {
    if (spTouchY === null) return;
    const rect   = scrollPill.getBoundingClientRect();
    const half   = rect.height / 2;
    const offset = spTouchY - (rect.top + half);
    const norm   = Math.max(-1, Math.min(1, offset / half));

    spAccum += Math.sign(norm) * (norm * norm) * SP_MAX_RATE;

    const lines = Math.trunc(spAccum);
    if (lines !== 0) {
      // Arrow keys in tmux copy mode scroll line by line
      const key = lines < 0 ? '\x1b[A' : '\x1b[B';
      for (let i = 0; i < Math.abs(lines); i++) sendData(key);
      spAccum -= lines;
    }
  }

  function spUpdateFromTouch(touchY) {
    const rect   = scrollPill.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    spTouchY     = touchY;
    scrollPill.classList.toggle('sp-active-up',   touchY < center);
    scrollPill.classList.toggle('sp-active-down',  touchY >= center);
  }

  scrollPill.addEventListener('touchstart', (e) => {
    e.preventDefault();
    clearInterval(spTicker);
    spAccum = 0;
    spUpdateFromTouch(e.touches[0].clientY);
    spTicker = setInterval(spTick, 16);
  }, { passive: false });

  scrollPill.addEventListener('touchmove', (e) => {
    e.preventDefault();
    spUpdateFromTouch(e.touches[0].clientY);
  }, { passive: false });

  function spStopAll() {
    clearInterval(spTicker);
    spTicker  = null;
    spTouchY  = null;
    spAccum   = 0;
    scrollPill.classList.remove('sp-active-up', 'sp-active-down');
  }

  scrollPill.addEventListener('touchend',    spStopAll, { passive: true });
  scrollPill.addEventListener('touchcancel', spStopAll, { passive: true });

  function setScrollMode(on) {
    scrollMode = on;
    scrollBtn.classList.toggle('active', on);
    scrollPill.classList.toggle('open', on);
    scrollBottomBtn.classList.toggle('open', on);
    if (on) {
      // Enter tmux copy mode (prefix + [)
      const prefix = keybinds.prefix || '\x02';
      sendData(prefix + '[');
    } else {
      spStopAll();
      sendData('q'); // exit tmux copy mode
    }
  }

  scrollBottomBtn.addEventListener('click', () => setScrollMode(false));

  scrollBtn.addEventListener('click', () => setScrollMode(!scrollMode));

  // ── Reconnect toast ───────────────────────────────────────
  const reconnectToast = document.getElementById('reconnect-toast');
  function showReconnectToast(msg) {
    reconnectToast.textContent = msg;
    reconnectToast.classList.add('visible');
  }
  function hideReconnectToast() {
    reconnectToast.classList.remove('visible');
  }

  // ── WebSocket connection ──────────────────────────────────
  function connect(host, port, session = 'termtunnel') {
    clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${host}:${port}/ws?session=${encodeURIComponent(session)}`;

    setStatus('connecting');
    setError('');

    try {
      ws = new WebSocket(url);
    } catch (e) {
      setError('Invalid host/port');
      setStatus('error');
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'data') {
        const decoded = decodeURIComponent(escape(atob(msg.data)));
        term.write(decoded);
      } else if (msg.type === 'status') {
        if (msg.data === 'connected') {
          wasConnected = true;
          if (msg.keybinds) applyKeybinds(msg.keybinds);
          hideOverlay();
          hideReconnectToast();
          setStatus('connected');
          doFit();
          term.focus();
          scrollBtn.classList.remove('d-none');
        } else if (msg.data === 'disconnected') {
          if (ws) ws.onclose = null;
          setStatus('idle');
          setScrollMode(false);
          scrollBtn.classList.add('d-none');
          scheduleReconnect();
        }
      } else if (msg.type === 'error') {
        setError(msg.data);
        setStatus('error');
        term.writeln(`\r\n\x1b[31m[error] ${msg.data}\x1b[0m`);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      if (!loadSettings().autoReconnect) setError('Connection failed');
    };

    ws.onclose = () => {
      setStatus('error');
      scheduleReconnect();
    };
  }

  // ── Auto-reconnect ────────────────────────────────────────
  function scheduleReconnect() {
    const s = loadSettings();
    if (!s.autoReconnect) return;
    if (reconnectAttempts >= MAX_RECONNECT) {
      hideReconnectToast();
      showOverlay();
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), RECONNECT_CAP);
    reconnectAttempts++;
    showReconnectToast(`Reconnecting ${reconnectAttempts}/${MAX_RECONNECT}…`);
    setStatus('connecting');
    reconnectTimer = setTimeout(() => {
      const { session } = loadConn();
      connect(ORIGIN_HOST, ORIGIN_PORT, session || 'termtunnel');
    }, delay);
  }

  // ── Background / foreground handling ─────────────────────
  // When iOS backgrounds the app the WebSocket is likely killed.
  // When the user returns, silently reconnect without showing the overlay.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wasConnected) {
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearTimeout(reconnectTimer);
        reconnectAttempts = 0;
        const { session } = loadConn();
        connect(ORIGIN_HOST, ORIGIN_PORT, session || 'termtunnel');
      }
    }
  });

  // ── Overlay helpers ───────────────────────────────────────
  function showOverlay() {
    document.getElementById('connect-overlay').classList.remove('hidden');
  }
  function hideOverlay() {
    document.getElementById('connect-overlay').classList.add('hidden');
  }
  function setError(msg) {
    document.getElementById('connect-error').textContent = msg;
  }

  // ── Session picker ────────────────────────────────────────
  const selSession = document.getElementById('inp-session');
  const inpSessionNew = document.getElementById('inp-session-new');

  selSession.addEventListener('change', () => {
    if (selSession.value === '__new__') {
      inpSessionNew.classList.remove('d-none');
      inpSessionNew.focus();
    } else {
      inpSessionNew.classList.add('d-none');
    }
  });

  async function loadSessions() {
    const subtitle = document.getElementById('connect-subtitle');
    const connectBtn = document.getElementById('connect-btn');
    try {
      const r = await fetch('/api/sessions');
      if (!r.ok) throw new Error();
      const { sessions } = await r.json();
      const saved = loadConn();
      let opts = '';
      // If last-used session is not in the active list, show it as a special option
      if (saved.session && !(sessions || []).includes(saved.session)) {
        opts += `<option value="__last__">↩ last used: ${saved.session}</option>`;
      }
      opts += (sessions || []).map(s => `<option value="${s}">${s}</option>`).join('');
      opts += '<option value="__new__">＋  New session…</option>';
      selSession.innerHTML = opts;
      // Pre-select last-used if it's in the active list
      if (saved.session && (sessions || []).includes(saved.session)) {
        selSession.value = saved.session;
      }
      inpSessionNew.classList.add('d-none');
      subtitle.textContent = 'Choose a session';
      connectBtn.disabled = false;
    } catch {
      subtitle.textContent = 'Server offline';
    }
  }

  async function initConnectScreen() {
    try {
      const r = await fetch('/health');
      if (!r.ok) throw new Error();
      await loadSessions();
    } catch {
      document.getElementById('connect-subtitle').textContent = 'Server offline';
    }
  }

  // ── Connect form ──────────────────────────────────────────
  document.getElementById('connect-btn').addEventListener('click', () => {
    const raw = selSession.value;
    const session = raw === '__new__'
      ? (inpSessionNew.value.trim() || 'termtunnel')
      : raw === '__last__'
      ? loadConn().session
      : (raw || 'termtunnel');
    saveConn({ session });
    connect(ORIGIN_HOST, ORIGIN_PORT, session);
  });

  initConnectScreen();

  // ── Reconnect button ──────────────────────────────────────
  document.getElementById('reconnect-btn').addEventListener('click', () => {
    closeSettings();
    reconnectAttempts = 0;
    const { session } = loadConn();
    connect(ORIGIN_HOST, ORIGIN_PORT, session || 'termtunnel');
  });

  document.getElementById('switch-btn').addEventListener('click', () => {
    closeSettings();
    closeTbPopup();
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    wasConnected = false;
    setStatus('idle');
    loadSessions();
    showOverlay();
  });

  // ── Settings panel ────────────────────────────────────────
  const backdrop = document.getElementById('settings-backdrop');
  const panel = document.getElementById('settings-panel');

  function openSettings() {
    const s = loadSettings();
    document.getElementById('set-fontsize').value = s.fontSize;
    document.getElementById('set-kb-fontsize').value = s.kbFontSize;
    document.getElementById('set-scrollback').value = s.scrollback;
    document.querySelectorAll('#set-cursor .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === s.cursorStyle);
    });
    document.getElementById('set-reconnect').checked = s.autoReconnect;
    backdrop.classList.add('open');
    panel.classList.add('open');
    fetchVersion();
  }
  function closeSettings() {
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    applySettings();
    term.focus();
  }

  // ── Version / update check ────────────────────────────────
  function fetchVersion() {
    fetch('/api/version')
      .then(r => r.json())
      .then(v => {
        document.getElementById('version-hash').textContent = `${v.shortHash} · ${v.branch}`;
      })
      .catch(() => {});
  }

  document.getElementById('check-update-btn').addEventListener('click', () => {
    const btn = document.getElementById('check-update-btn');
    const status = document.getElementById('update-status');
    btn.disabled = true;
    btn.textContent = '…';
    status.textContent = '';
    status.className = '';
    fetch('/api/check-update')
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          status.textContent = 'Check failed — is git available on the server?';
        } else if (data.upToDate) {
          status.textContent = 'Up to date.';
        } else {
          status.textContent = `${data.behind} commit${data.behind === 1 ? '' : 's'} behind — run update.sh in the terminal.`;
          status.classList.add('has-update');
        }
      })
      .catch(() => { status.textContent = 'Check failed.'; })
      .finally(() => { btn.disabled = false; btn.textContent = 'Check'; });
  });

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  backdrop.addEventListener('click', closeSettings);

  document.querySelectorAll('#set-cursor .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#set-cursor .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.documentElement.style.setProperty('--kb-font-size', settings.kbFontSize + 'px');

  function applySettings() {
    const s = {
      fontSize: parseInt(document.getElementById('set-fontsize').value, 10) || 14,
      kbFontSize: parseInt(document.getElementById('set-kb-fontsize').value, 10) || 22,
      scrollback: parseInt(document.getElementById('set-scrollback').value, 10) || 2000,
      cursorStyle: document.querySelector('#set-cursor .seg-btn.active')?.dataset.value || 'block',
      autoReconnect: document.getElementById('set-reconnect').checked,
    };
    saveSettings(s);
    document.documentElement.style.setProperty('--kb-font-size', s.kbFontSize + 'px');
    Object.assign(term.options, {
      fontSize: s.fontSize,
      scrollback: s.scrollback,
      cursorStyle: s.cursorStyle,
    });
    doFit();
  }

  // ── Clipboard ─────────────────────────────────────────────
  function flashBtn(btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 300);
  }

  // ── Custom Keyboard ───────────────────────────────────────
  const kbKeyboard  = document.getElementById('kb-keyboard');
  const kbToolbar   = document.getElementById('kb-toolbar');
  const kbCtrlKey    = document.getElementById('kb-ctrl');
  const kbCtrlNumKey = document.getElementById('kb-ctrl-num');
  const kbCtrlSymKey = document.getElementById('kb-ctrl-sym');
  const kbShiftKey  = document.getElementById('kb-shift');

  const kbState = {
    toolbarOpen: false,
    keyboardOpen: false,
    ctrlActive: false,
    shiftActive: false,
  };

  const statusBar = document.getElementById('status-bar');

  function applyKbState() {
    const showToolbar = kbState.toolbarOpen || kbState.keyboardOpen;

    // Read layout before writes to avoid interleaved reflows
    const targetH = kbState.keyboardOpen ? kbKeyboard.scrollHeight : 0;

    // Batch all DOM writes
    document.documentElement.style.setProperty('--kb-actual-h', targetH + 'px');
    document.documentElement.style.setProperty('--toolbar-visible-h', showToolbar ? 'var(--toolbar-h)' : '0px');
    kbKeyboard.classList.toggle('open', kbState.keyboardOpen);
    kbToolbar.classList.toggle('open', showToolbar);
    statusBar.classList.toggle('pill-hidden', kbState.keyboardOpen);
  }

  // Refit terminal after keyboard transition completes
  kbKeyboard.addEventListener('transitionend', () => { invalidateKeyCache(); scheduleFit(); });

  // Tap-outside collapses toolbar (only when toolbar open, keyboard closed)
  // Excludes terminal-wrap — the terminal tap handler manages that case
  document.addEventListener('pointerdown', (e) => {
    if (!kbState.toolbarOpen || kbState.keyboardOpen) return;
    const termWrapEl = document.getElementById('terminal-wrap');
    if (!kbToolbar.contains(e.target) && !termWrapEl.contains(e.target)) {
      kbState.toolbarOpen = false;
      applyKbState();
    }
  });

  // Tap terminal to open/dismiss keyboard
  {
    const termWrap = document.getElementById('terminal-wrap');
    const connectOverlayEl = document.getElementById('connect-overlay');
    let termTap = null;

    termWrap.addEventListener('touchstart', (e) => {
      if (!connectOverlayEl.classList.contains('hidden')) return;
      const t = e.changedTouches[0];
      termTap = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
    }, { passive: true, capture: true });

    termWrap.addEventListener('touchmove', (e) => {
      if (!termTap) return;
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - termTap.x, t.clientY - termTap.y) > 8) termTap.moved = true;
    }, { passive: true, capture: true });

    termWrap.addEventListener('touchend', (e) => {
      if (!termTap) return;
      const { moved, time } = termTap;
      termTap = null;
      if (moved || Date.now() - time > 300) return;
      const open = !kbState.keyboardOpen;
      kbState.keyboardOpen = open;
      kbState.toolbarOpen  = open;
      applyKbState();
    }, { passive: true, capture: true });
  }

  // Page swap helpers
  const KB_PAGES = ['kb-page-qwerty', 'kb-page-num', 'kb-page-sym'];
  function showKbPage(id) {
    KB_PAGES.forEach(p => document.getElementById(p).classList.toggle('active', p === id));
    invalidateKeyCache();
  }

  document.getElementById('kb-123-btn').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); showKbPage('kb-page-num');
  });
  document.getElementById('kb-sym-btn').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); showKbPage('kb-page-sym');
  });
  document.getElementById('kb-123-from-sym-btn').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); showKbPage('kb-page-num');
  });
  document.getElementById('kb-abc-btn').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); showKbPage('kb-page-qwerty');
  });
  document.getElementById('kb-abc-from-sym-btn').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); showKbPage('kb-page-qwerty');
  });

  // Sticky Ctrl — single tap toggles modifier
  const allCtrlKeys = [kbCtrlKey, kbCtrlNumKey, kbCtrlSymKey];
  function toggleCtrl() {
    kbState.ctrlActive = !kbState.ctrlActive;
    allCtrlKeys.forEach(k => k.classList.toggle('active', kbState.ctrlActive));
  }
  function clearCtrl() {
    kbState.ctrlActive = false;
    allCtrlKeys.forEach(k => k.classList.remove('active'));
  }

  allCtrlKeys.forEach(k => {
    k.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      toggleCtrl();
    });
  });

  // Sticky Shift — single class toggle instead of mutating 27 key labels
  const kbQwertyPage = document.getElementById('kb-page-qwerty');
  kbShiftKey.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    kbState.shiftActive = !kbState.shiftActive;
    kbShiftKey.classList.toggle('active', kbState.shiftActive);
    kbQwertyPage.classList.toggle('shifted', kbState.shiftActive);
  });

  // Key repeat state (for hold-to-repeat keys like ⌫)
  let kbRepeatDelay = null;
  let kbRepeatInterval = null;
  function kbStopRepeat() {
    clearTimeout(kbRepeatDelay);
    clearInterval(kbRepeatInterval);
    kbRepeatDelay = kbRepeatInterval = null;
  }
  document.addEventListener('pointerup',     kbStopRepeat);
  document.addEventListener('pointercancel', kbStopRepeat);

  // ── Nearest-key hit testing ───────────────────────────────
  let kbKeyCache = null; // { pageId: string, keys: [{el, cx, cy}] }

  function invalidateKeyCache() { kbKeyCache = null; }

  function findNearestKey(x, y) {
    const activePage = kbKeyboard.querySelector('.kb-page.active');
    if (!activePage) return null;
    if (kbKeyCache?.pageId !== activePage.id) {
      const all = Array.from(activePage.querySelectorAll('.kb-key')).map(el => {
        const r = el.getBoundingClientRect();
        const isData = el.hasAttribute('data-char') || el.hasAttribute('data-send');
        return { el, r, isData, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      kbKeyCache = { pageId: activePage.id, all };
    }
    // Exact rect hit across ALL keys — non-data keys (ctrl, shift, page buttons) return null
    // so their own handlers take over uninterrupted
    for (const k of kbKeyCache.all) {
      const r = k.r;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return k.isData ? k.el : null;
      }
    }
    // Fallback: nearest center for taps in the gaps between keys (data keys only)
    let nearest = null, minDist = Infinity;
    for (const k of kbKeyCache.all) {
      if (!k.isData) continue;
      const d = (x - k.cx) ** 2 + (y - k.cy) ** 2;
      if (d < minDist) { minDist = d; nearest = k.el; }
    }
    return nearest;
  }

  // Shared dispatch logic
  function kbDispatch(key) {
    let payload;
    if (key.dataset.char !== undefined) {
      const ch = kbState.shiftActive ? key.dataset.char.toUpperCase() : key.dataset.char;
      if (kbState.ctrlActive) {
        payload = String.fromCharCode(ch.toLowerCase().charCodeAt(0) - 96);
        clearCtrl();
      } else {
        payload = ch;
      }
      if (kbState.shiftActive) {
        kbState.shiftActive = false;
        kbShiftKey.classList.remove('active');
        kbQwertyPage.classList.remove('shifted');
      }
    } else {
      payload = key.dataset.send;
    }
    sendData(payload);
  }

  kbKeyboard.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    const key = findNearestKey(t.clientX, t.clientY);
    if (!key || allCtrlKeys.includes(key) || key === kbShiftKey) return;
    e.preventDefault(); // block iOS text selection, callout, and system highlight
    kbDispatch(key);
    if (key.hasAttribute('data-repeat')) {
      kbStopRepeat();
      kbRepeatDelay = setTimeout(() => {
        kbRepeatInterval = setInterval(() => sendData(key.dataset.send), 80);
      }, 320);
    }
  }, { passive: false });

  // Toolbar key dispatch
  kbToolbar.addEventListener('pointerdown', (e) => {
    const key = e.target.closest('[data-send]');
    if (!key) return;
    if (key.hasAttribute('data-lp')) return;
    e.stopPropagation();
    sendData(key.dataset.send);
  });

  // ── Toolbar long-press system ─────────────────────────────
  const tbPopup   = document.getElementById('tb-popup');
  let tbLpTimer   = null;
  let tbLpActive  = false;
  let tbLpItems   = [];
  let tbLpHigh    = null;

  const TB_MENUS = {
    'tb-esc': [
      { label: '^\\  SIGQUIT',       send: '\x1c' },
      { label: 'Alt+.  last arg',    send: '\x1b.' },
    ],
  };

  function openTbPopup(btn, items) {
    tbLpItems = items;
    tbPopup.innerHTML = items.map((item, i) =>
      `<div class="tp-item" data-idx="${i}">${item.label}</div>`
    ).join('');

    const rect = btn.getBoundingClientRect();
    const popupW = 200;
    let left = rect.left + rect.width / 2 - popupW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
    const bottom = window.innerHeight - rect.top + 6;

    tbPopup.style.cssText = `left:${left}px;bottom:${bottom}px;width:${popupW}px`;
    tbLpActive = true;
    tbPopup.classList.add('open');
  }

  function closeTbPopup() {
    tbLpActive = false;
    tbPopup.classList.remove('open');
    if (tbLpHigh) { tbLpHigh.classList.remove('highlighted'); tbLpHigh = null; }
  }

  function highlightTbAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const item = el?.closest('.tp-item') || null;
    if (item === tbLpHigh) return;
    if (tbLpHigh) tbLpHigh.classList.remove('highlighted');
    tbLpHigh = item;
    if (tbLpHigh) tbLpHigh.classList.add('highlighted');
  }

  // Wire up long-press on each data-lp toolbar button
  kbToolbar.querySelectorAll('[data-lp]').forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
      tbLpTimer = setTimeout(() => {
        const menu = TB_MENUS[btn.id];
        if (menu) openTbPopup(btn, menu);
      }, 400);
    }, { passive: true });

    btn.addEventListener('touchmove', (e) => {
      if (!tbLpActive) return;
      const t = e.touches[0];
      highlightTbAt(t.clientX, t.clientY);
    }, { passive: true });

    btn.addEventListener('touchend', (e) => {
      clearTimeout(tbLpTimer);
      if (tbLpActive) {
        const payload = tbLpItems[parseInt(tbLpHigh?.dataset.idx, 10)]?.send;
        closeTbPopup();
        if (payload !== undefined) sendData(payload);
      } else {
        // Short tap — send the button's own payload
        sendData(btn.dataset.send);
      }
    });

    btn.addEventListener('touchcancel', () => {
      clearTimeout(tbLpTimer);
      closeTbPopup();
    });
  });

  // Tap outside closes the popup
  document.addEventListener('pointerdown', (e) => {
    if (tbLpActive && !tbPopup.contains(e.target)) closeTbPopup();
  });
})();

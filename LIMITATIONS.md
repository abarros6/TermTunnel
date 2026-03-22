# TermTunnel — PWA Limitations

A reference for what is and isn't possible when building on top of iOS Safari / Android Chrome PWA + xterm.js. Current as of iOS 18 / Safari 18 / Android Chrome 124 (March 2026).

Primary development target is iOS Safari. Android is a secondary target — the architecture is cross-platform but some behaviors differ.

---

## Input & Keyboard

### Native Keyboard Suppression
- **Possible.** Setting `inputmode="none"` on xterm's hidden textarea (`xterm-helper-textarea`) prevents the iOS native keyboard from appearing.
- Once suppressed, all input must come from a custom UI — no native keyboard fallback.
- Physical Bluetooth keyboards still work fine through the browser regardless.

### Custom Keyboard Input
- Send input to the terminal via `term.input(string)` directly from button taps.
- No DOM keyboard events needed.
- Special keys are just strings:
  - `Ctrl+C` → `\x03`
  - `Ctrl+D` → `\x04`
  - `Ctrl+Z` → `\x1a`
  - `Esc` → `\x1b`
  - Arrow Up → `\x1b[A`
  - Arrow Down → `\x1b[B`
  - Arrow Right → `\x1b[C`
  - Arrow Left → `\x1b[D`
  - Tab → `\x09`
  - Backspace → `\x7f`

### Touch Behavior
- ~300ms tap delay is mostly mitigated by `touch-action: manipulation` on interactive elements.
- No hover states — all interactions must be tap-based.
- Multi-touch is possible (e.g. hold Ctrl, tap a letter) but requires careful `touchstart`/`touchend` tracking.
- Long-press for alternate characters is implementable but needs custom gesture handling.

---

## Screen Real Estate

- With native keyboard suppressed, the full screen height is available at all times — `visualViewport` no longer shrinks when a "keyboard" is shown.
- Typical iPhone viewport: ~390px wide. Height varies by model (844px on iPhone 14, 932px on 14 Plus/Pro Max).
- Landscape gives more width (~844px) but less height (~390px).
- A custom keyboard taking the bottom ~40% leaves ~60% for the terminal — roughly 200–250px tall in portrait, which is tight but workable.
- A toggleable keyboard (show/hide) can give the terminal full screen when not typing.

---

## Notifications

### Web Push Notifications
- **Supported on iOS 16.4+**, but only when the app is installed as a PWA (not a browser tab).
- Requires user permission grant.
- Requires backend infrastructure: VAPID keys, push subscription management, server-sent push payloads (Web Push protocol).
- Shows as a real iOS system notification with sound and banner — works when app is backgrounded.
- Useful for: alerting when a long-running command finishes.

### In-App Notifications
- Full control over visual in-app alerts, banners, toasts while the app is in the foreground.

### What Doesn't Work
- **Haptic feedback** — blocked entirely for web on iOS. No vibration API support.
- **Notification sound in background** without push — Web Audio API only plays when the app is in foreground.
- **Home screen badge count** — not supported for iOS PWAs.

---

## Clipboard

- **Reading clipboard** (paste) requires `navigator.clipboard.readText()` — triggers a system permission prompt on first use.
- **Writing clipboard** (copy) via `navigator.clipboard.writeText()` works without a prompt as long as it's triggered by a user gesture.
- xterm selection → clipboard works via the Copy button approach already in the app.

---

## Networking & Connectivity

- PWA can only communicate over HTTP/HTTPS and WebSocket/WSS.
- No raw TCP sockets from the browser — all terminal I/O must go through the WebSocket bridge.
- Tailscale handles the secure tunnel at the network layer — no need for TLS on the Node server within the Tailscale network.
- WebSocket drops when iOS backgrounds the app — tmux on the server side keeps the session alive across reconnects.
- Background reconnect on `visibilitychange` is the correct pattern for iOS.

---

## Storage

- `localStorage` — synchronous, ~5MB limit, persists across sessions. Used for connection config.
- `sessionStorage` — same as localStorage but cleared on tab close.
- `IndexedDB` — async, larger storage, good for scrollback history or settings blobs.
- No access to the filesystem.

---

## PWA Installation

- **iOS only supports "Add to Home Screen" from Safari** — Chrome, Firefox, and other iOS browsers cannot install PWAs (Apple forces WebKit on all iOS browsers).
- Installed PWAs run in standalone mode (no browser chrome) when `"display": "standalone"` is set in the manifest.
- Service worker caches assets — users need to hard-reload or reinstall the PWA to pick up frontend changes during development.
- No native "Install App" prompt on iOS like Android/Chrome — the flow is always Share → Add to Home Screen.

---

## Audio

- Web Audio API works in foreground.
- No audio playback when the app is backgrounded without a push notification.
- Terminal bell (`\x07`) can be implemented via Web Audio in the foreground.

---

## Other Restrictions

- **No haptics** — `navigator.vibrate()` is not supported on iOS.
- **No background execution** — when backgrounded, JS execution is suspended after a few seconds. Cannot run tasks or maintain connections in the background (WebSocket drops are expected).
- **No native share sheet triggering** without a user gesture.
- **Screen wake lock** (`navigator.wakeLock`) — supported in Safari 16.4+. Can prevent the screen from sleeping while the terminal is active.
- **Pointer Lock API** — not supported on iOS. Cannot capture pointer for mouse-in-terminal use cases.
- **WebRTC** — available but not relevant to this project.

---

## Text Selection

- xterm.js selection on touch is finicky — iOS native text selection gestures conflict with terminal scroll.
- Selecting text to copy is awkward without custom handling. The Copy button approach (copy current xterm selection) is the practical workaround.

---

## Safe Area / Notch

- iPhone notch and home indicator inset into the viewport. Use `env(safe-area-inset-bottom)` CSS to prevent the home indicator overlapping the custom keyboard.
- Android has a similar navigation bar inset at the bottom — same CSS applies, different values.
- Easy to handle but easy to forget. Apply to any fixed bottom UI.

---

## Scroll Behavior

- iOS momentum/rubber-band scrolling can interfere with terminal scroll.
- Use `overscroll-behavior: none` on the terminal container and careful `touch-action` settings to prevent the page bouncing when scrolling the terminal.

---

## Orientation Change

- Rotating the device fires `resize`, but Safari has a bug where viewport dimensions are briefly wrong immediately after rotation.
- Add a short delay (~100ms) before calling `fitAddon.fit()` on orientation change to get correct dimensions.

---

## Custom Keyboard & `visualViewport`

- Since the custom keyboard lives in the DOM (not a native keyboard), `visualViewport` does not shrink to account for it.
- Terminal height must be managed manually — calculate available height as `window.innerHeight - keyboardHeight` and resize xterm accordingly.

---

## Service Worker in Development

- The service worker caches assets aggressively and will serve stale HTML/JS during development.
- Workaround: disable service worker in Safari/Chrome DevTools (Application → Service Workers → Bypass for network), or increment the cache version on each change.
- On iOS, the only reliable way to force a fresh load without DevTools is to delete and reinstall the PWA.

---

## Android

The core architecture (WebSocket + xterm.js + node-pty) is platform-agnostic. Android Chrome is a capable target with some meaningful differences from iOS Safari:

### Better than iOS on Android
- **PWA installation** — Chrome gives a proper "Install App" banner. No buried Share sheet flow.
- **Web Push** — Chrome has supported it for years, more mature and reliable than iOS 16.4+ implementation.
- **Haptics** — `navigator.vibrate()` works on Android. Can add tap feedback on keyboard keys.
- **Standards compliance** — Chrome is generally more permissive and closer to web standards than Safari.

### Android-specific concerns
- **Screen size variety** — Android has far more screen size and density variation than iPhone. Layout must be flexible, not hardcoded to iPhone dimensions.
- **Navigation bar** — Android's back/home/recents bar eats into the bottom of the viewport. `env(safe-area-inset-bottom)` handles it, but values differ from iOS.
- **`visualViewport` behavior** — Chrome on Android fires keyboard resize events differently from Safari. Since the native keyboard is suppressed, this mostly doesn't matter, but worth knowing if debugging layout issues.
- **OEM browsers** — Samsung Internet and other Android OEM browsers have quirks. Chrome is the safe baseline; others are untested.
- **`inputmode="none"`** — standard HTML attribute, works on Android Chrome the same as iOS Safari to suppress the native keyboard.

### What's actually iOS-specific in the codebase
Nothing in the current architecture is iOS-only. The `inputmode="none"` fix, `visibilitychange` reconnect logic, and safe area CSS all work on Android. Layout will need testing on Android screen sizes but no code changes should be required in principle.

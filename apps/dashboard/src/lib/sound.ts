// Lightweight success/failure beeps for deploy completion. Synthesised with the
// Web Audio API so there are no audio assets to bundle, host, or whitelist in
// the CSP — a single oscillator + gain envelope per beep.
//
// Browsers block audio until the user has interacted with the page. Since the
// beeps only fire after the user clicks Deploy/Migrate, the AudioContext is
// already unlocked by then; we still guard against a suspended context.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  // Browsers block audio until the user interacts; ignore the rejection.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Play a sequence of (frequency, startOffset, duration) notes.
function playTones(notes: { freq: number; at: number; dur: number }[]) {
  const audio = getCtx();
  if (!audio) return;
  const now = audio.currentTime;
  for (const { freq, at, dur } of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Short attack/decay envelope to avoid clicks.
    const start = now + at;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + dur);
  }
}

// Rising two-note chime — a deploy went live.
export function playSuccessBeep() {
  playTones([
    { freq: 660, at: 0, dur: 0.16 },
    { freq: 990, at: 0.14, dur: 0.22 },
  ]);
}

// Falling two-note buzz — a deploy failed.
export function playFailureBeep() {
  playTones([
    { freq: 440, at: 0, dur: 0.18 },
    { freq: 220, at: 0.16, dur: 0.3 },
  ]);
}

// Soft two-note "ding" for an incoming notification / chat message. Called from
// a poll or stream callback (not a click), so it only sounds once the page has
// had some user interaction; a still-locked AudioContext just stays silent.
export function playNotifyChime() {
  playTones([
    { freq: 880, at: 0, dur: 0.12 },
    { freq: 1175, at: 0.1, dur: 0.2 },
  ]);
}

// ---- Support-chat message chime ------------------------------------------

const MUTE_KEY = "upande-chat-muted";
export const CHAT_MUTE_EVENT = "upande:chat-mute";
const BURST_MS = 1500;

// Message ids already chimed for, so the stream, the page, the floating widget
// and the bell's notification alert never sound twice for the same message.
const chimed = new Set<string>();
let lastChimeAt = 0;

export function isChatMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setChatMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* storage blocked: the toggle still applies for this page view */
  }
  window.dispatchEvent(new Event(CHAT_MUTE_EVENT));
}

// Short bright three-note "pop" for an incoming chat message — distinct from
// the deploy success/failure beeps.
function messageChime() {
  playTones([
    { freq: 1047, at: 0, dur: 0.08 },
    { freq: 1319, at: 0.07, dur: 0.08 },
    { freq: 1568, at: 0.14, dur: 0.14 },
  ]);
}

/**
 * Chime for an incoming message from the other side. Deduped per message id
 * and debounced so a burst plays once per ~1.5s. Silent when muted, and when
 * the browser still blocks audio (no user interaction yet).
 */
export function playMessageChime(messageId?: string): void {
  if (messageId) {
    if (chimed.has(messageId)) return;
    chimed.add(messageId);
    if (chimed.size > 500) chimed.clear();
  }
  if (isChatMuted()) return;
  const now = Date.now();
  if (now - lastChimeAt < BURST_MS) return;
  lastChimeAt = now;
  try {
    messageChime();
  } catch {
    /* audio blocked / unavailable */
  }
}

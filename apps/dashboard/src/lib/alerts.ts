// Helpers for surfacing NEW notifications beyond the bell: browser (desktop)
// notifications and an unread count in the tab title. Kept identical between
// the dashboard and admin apps.

const PREF_KEY = "upande-desktop-notifications";

// Captured once so repeated updates don't stack "(3) (2) …" prefixes.
const BASE_TITLE = typeof document !== "undefined" ? document.title : "";

/** "(3) Upande Cloud — Dashboard"; plain base title when nothing is unread. */
export function setTitleUnread(count: number): void {
  if (typeof document === "undefined") return;
  document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${BASE_TITLE}` : BASE_TITLE;
}

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREF_KEY, "1");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage blocked: preference just won't persist */
  }
}

export type DesktopState = "unsupported" | "denied" | "off" | "on";

/** Desktop alerts fire only when the user opted in AND the browser allows it. */
export function desktopState(): DesktopState {
  if (!desktopSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && readPref() ? "on" : "off";
}

/** Explicit opt-in from the bell's "Enable desktop notifications" control. */
export async function enableDesktop(): Promise<DesktopState> {
  if (!desktopSupported()) return "unsupported";
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  writePref(perm === "granted");
  return desktopState();
}

export function disableDesktop(): DesktopState {
  writePref(false);
  return desktopState();
}

/** Show a desktop notification — only when opted in and the tab is hidden. */
export function showDesktop(title: string, body: string, tag: string, onClick?: () => void): void {
  if (desktopState() !== "on" || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag, icon: "/upande-logo.png" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some browsers throw outside a service worker; the toast still shows */
  }
}

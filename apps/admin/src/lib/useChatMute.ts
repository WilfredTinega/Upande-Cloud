import { useEffect, useState } from "react";
import { CHAT_MUTE_EVENT, isChatMuted, setChatMuted } from "./sound";

/** Chat-sound mute state, synced across every chat view on the page. */
export function useChatMute(): [boolean, () => void] {
  const [muted, setMuted] = useState(() => isChatMuted());
  useEffect(() => {
    const sync = () => setMuted(isChatMuted());
    window.addEventListener(CHAT_MUTE_EVENT, sync);
    return () => window.removeEventListener(CHAT_MUTE_EVENT, sync);
  }, []);
  return [muted, () => setChatMuted(!muted)];
}

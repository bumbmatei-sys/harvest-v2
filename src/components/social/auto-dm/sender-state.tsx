"use client";
import { createContext, useContext } from "react";

const SenderState = createContext(false);
/** The pages read SOCIAL_AUTO_DM_SENDER_ENABLED on the server and pass it here, so the notice and the badge cannot go stale when the constant changes. */
export function SenderProvider({ sendEnabled, children }: { sendEnabled: boolean; children: React.ReactNode }) {
  return <SenderState.Provider value={sendEnabled}>{children}</SenderState.Provider>;
}
export const useSendEnabled = () => useContext(SenderState);

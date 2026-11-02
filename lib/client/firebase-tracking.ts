"use client";
import { initializeApp, deleteApp } from "firebase/app";
import {
  initializeAuth,
  inMemoryPersistence,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import { getDatabase, ref, onValue, goOffline } from "firebase/database";
import { firebaseConfig } from "./firebase-config";
import { postAccountData } from "./session";
import { createTrackingHub } from "./tracking-hub";

const hub = createTrackingHub(async (userId, onConnection) => {
  const session = await postAccountData<{
    userId: string;
    token: string;
    mapboxToken: string | null;
  }>("/api/tracking/session", {});
  if (session.userId !== userId)
    throw new Error("Account changed. Please reload.");
  const app = initializeApp(
    firebaseConfig,
    `street-tracking-${crypto.randomUUID()}`,
  );
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const db = getDatabase(app);
  let stopConnection: (() => void) | undefined;
  const dispose = async () => {
    stopConnection?.();
    goOffline(db);
    await signOut(auth).catch(() => {});
    await deleteApp(app);
  };
  try {
    const credential = await signInWithCustomToken(auth, session.token);
    if (credential.user.uid !== userId)
      throw new Error("Tracking account mismatch.");
    stopConnection = onValue(ref(db, ".info/connected"), (snapshot) =>
      onConnection(snapshot.val() === true ? "live" : "offline"),
    );
    return {
      mapboxToken: session.mapboxToken,
      listen: (
        id: string,
        value: (value: unknown) => void,
        error: () => void,
      ) =>
        onValue(
          ref(db, `orders/${id}`),
          (snapshot) => value(snapshot.val()),
          error,
        ),
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
});
// Cookie-based STREET sign-out/account changes also end the independent Firebase
// session. Broadcast only invalidation, never identities or credentials.
if (typeof window !== "undefined") {
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("street:tracking-session")
      : null;
  window.addEventListener("street:session-changed", () => {
    hub.reset();
    channel?.postMessage("reset");
  });
  if (channel) channel.onmessage = () => hub.reset();
}
export const subscribeTracking = hub.subscribe;

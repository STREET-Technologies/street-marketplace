"use client";
import { useEffect, useRef, useState } from "react";
import type { Customer } from "../lib/contracts";
import {
  appleCancelled,
  appleProof,
  loadAppleIdentity,
  type AppleIdentity,
} from "../lib/client/apple";
import { sessionRequest } from "../lib/client/session";

type Props = {
  intent?: "login" | "link";
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSuccess?: (user: Customer) => void;
  onConnected?: () => void;
};
export default function AppleSignIn(props: Props) {
  const intent = props.intent ?? "login";
  const callbacks = useRef(props);
  callbacks.current = props;
  const identity = useRef<AppleIdentity | null>(null);
  const pending = useRef(false);
  const [state, setState] = useState<
    "loading" | "disabled" | "ready" | "busy" | "error" | "linked"
  >("loading");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [revision, retry] = useState(0);
  const alive = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    identity.current = null;
    setState("loading");
    setError("");
    async function prepare() {
      try {
        const start = () =>
          fetch("/api/auth/apple/start", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent }),
            signal: controller.signal,
          });
        let response = await start();
        if (intent === "link" && response.status === 401) {
          await sessionRequest("refresh", {});
          if (!active) return;
          response = await start();
        }
        const data = await response.json();
        if (!active) return;
        if (!response.ok)
          throw new Error(
            data.error ?? "Apple sign-in is unavailable. Please try again.",
          );
        if (data.enabled === false) {
          setState("disabled");
          return;
        }
        if (
          typeof data.clientId !== "string" ||
          typeof data.redirectUri !== "string" ||
          typeof data.nonce !== "string" ||
          typeof data.state !== "string" ||
          typeof data.expiresIn !== "number"
        )
          throw new Error("Apple sign-in couldn’t load. Please try again.");
        const apple = await loadAppleIdentity();
        if (!active) return;
        apple.init({
          clientId: data.clientId,
          redirectURI: data.redirectUri,
          scope: "name email",
          state: data.state,
          nonce: data.nonce,
          usePopup: true,
        });
        apple.renderButton();
        identity.current = apple;
        setState("ready");
        expiry = setTimeout(
          () => {
            if (active && !pending.current) {
              setError("Apple sign-in has expired. Please try again.");
              setState("error");
            }
          },
          Math.max(0, data.expiresIn * 1000 - 1000),
        );
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Apple sign-in couldn’t load. Please try again.",
          );
          setState("error");
        }
      }
    }
    void prepare();
    return () => {
      active = false;
      alive.current = false;
      controller.abort();
      clearTimeout(expiry);
    };
  }, [intent, revision]);
  async function signIn() {
    if (
      pending.current ||
      callbacks.current.disabled ||
      state !== "ready" ||
      !identity.current ||
      (intent === "link" && !confirmed)
    )
      return;
    pending.current = true;
    setState("busy");
    setError("");
    callbacks.current.onBusy(true);
    try {
      // Invoke synchronously from the click so browsers allow the popup. The
      // challenge and SDK are prepared ahead of the user's gesture.
      const result = await identity.current.signIn();
      if (!alive.current) return;
      const data = await sessionRequest(
        intent === "link" ? "apple/link" : "apple",
        appleProof(result),
      );
      if (!alive.current) return;
      if (intent === "link") {
        setState("linked");
        callbacks.current.onConnected?.();
      } else {
        if (!data.user)
          throw new Error("Apple sign-in couldn’t finish. Please try again.");
        callbacks.current.onSuccess?.(data.user);
      }
    } catch (e) {
      if (alive.current) {
        if (appleCancelled(e)) retry((n) => n + 1);
        else {
          setError(
            e instanceof Error
              ? e.message
              : "Apple sign-in couldn’t finish. Please try again.",
          );
          setState("error");
        }
      }
    } finally {
      pending.current = false;
      callbacks.current.onBusy(false);
    }
  }
  if (state === "disabled") return null;
  if (state === "linked")
    return <p role="status">Apple is connected to your STREET account.</p>;
  return (
    <div className="apple-sign-in">
      {intent === "link" && (
        <>
          <h3>Sign in with Apple</h3>
          <label className="apple-link-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={props.disabled || state === "busy"}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Connect Apple to this STREET account
          </label>
        </>
      )}
      <div
        className="apple-sign-in-control"
        data-pending={state === "loading" || state === "busy" ? "true" : undefined}
        hidden={state === "error"}
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void signIn();
        }}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) void signIn();
          }
        }}
        onKeyUpCapture={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div
          id="appleid-signin"
          className="apple-sign-in-button"
          data-color="white"
          data-border="false"
          data-type="continue"
          data-border-radius="4"
          data-mode="center-align"
          data-width="100%"
          data-height="32"
          hidden={state === "error"}
          inert={
            props.disabled ||
            state !== "ready" ||
            (intent === "link" && !confirmed)
          }
          aria-busy={state === "busy"}
        />
        {(state === "loading" || state === "busy") && (
          <span className="apple-sign-in-progress" role="status">
            <span className="apple-sign-in-spinner" aria-hidden="true" />
            {state === "busy"
              ? intent === "link" ? "Connecting Apple…" : "Signing in…"
              : "Continue with Apple"}
          </span>
        )}
      </div>
      {state === "error" && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="text-link"
            disabled={props.disabled}
            onClick={() => retry((n) => n + 1)}
          >
            Try Apple again
          </button>
        </>
      )}
    </div>
  );
}

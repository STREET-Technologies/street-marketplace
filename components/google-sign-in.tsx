"use client";
import { useEffect, useRef, useState } from "react";
import type { Customer } from "../lib/contracts";
import { loadGoogleIdentity } from "../lib/client/google";
import { sessionRequest } from "../lib/client/session";

export default function GoogleSignIn(props: {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSuccess: (user: Customer) => void;
}) {
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [state, setState] = useState<
    "loading" | "disabled" | "ready" | "busy" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    let active = true,
      pending = false;
    const controller = new AbortController();
    let resize: ResizeObserver | undefined;
    setState("loading");
    setError("");
    async function start() {
      try {
        const response = await fetch("/api/auth/google/start", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!active) return;
        if (!response.ok)
          throw new Error(
            "Google sign-in is unavailable. Try again or sign in by phone.",
          );
        if (data.enabled === false) {
          setState("disabled");
          return;
        }
        if (typeof data.clientId !== "string" || typeof data.nonce !== "string")
          throw new Error(
            "Google sign-in is unavailable. You can sign in by phone.",
          );
        const identity = await loadGoogleIdentity();
        if (!active || !button.current) return;
        identity.initialize({
          client_id: data.clientId,
          nonce: data.nonce,
          auto_select: false,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            if (!active || pending || callbacks.current.disabled) return;
            pending = true;
            setState("busy");
            callbacks.current.onBusy(true);
            try {
              const result = await sessionRequest("google", {
                idToken: credential,
              });
              if (!result.user)
                throw new Error(
                  "Google sign-in couldn’t finish. Please try again.",
                );
              if (active) callbacks.current.onSuccess(result.user);
            } catch (e) {
              if (active) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Google sign-in couldn’t finish. Please try again.",
                );
                setState("error");
              }
            } finally {
              pending = false;
              callbacks.current.onBusy(false);
            }
          },
        });
        let renderedWidth = 0;
        const render = () => {
          if (!active || !button.current) return;
          const width = Math.floor(
            Math.min(
              360,
              Math.max(200, button.current.getBoundingClientRect().width),
            ),
          );
          if (width === renderedWidth) return;
          renderedWidth = width;
          button.current.replaceChildren();
          identity.renderButton(button.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            width,
          });
        };
        render();
        resize = new ResizeObserver(render);
        resize.observe(button.current);
        setState("ready");
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Google sign-in couldn’t load. You can sign in by phone.",
          );
          setState("error");
        }
      }
    }
    void start();
    return () => {
      active = false;
      controller.abort();
      resize?.disconnect();
    };
  }, [revision]);
  if (state === "disabled") return null;
  return (
    <div className="google-sign-in">
      <p className="sign-in-divider">or</p>
      <div
        ref={button}
        className="google-sign-in-button"
        hidden={state === "error"}
        inert={props.disabled || state !== "ready"}
        aria-busy={state === "busy"}
      />
      {state === "loading" && <p role="status">Loading Google sign-in…</p>}
      {state === "busy" && <p role="status">Signing in with Google…</p>}
      {state === "error" && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="text-link"
            disabled={props.disabled}
            onClick={() => retry((n) => n + 1)}
          >
            Try Google again
          </button>
        </>
      )}
      <p className="account-note">
        Already use STREET? Choose the same sign-in method you use in the app.
      </p>
    </div>
  );
}

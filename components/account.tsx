"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerEmptyState } from "./customer-page";
import type { Customer } from "../lib/contracts";
import { currentCustomer, sessionRequest } from "../lib/client/session";

export default function Account() {
  const [user, setUser] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    currentCustomer()
      .then((customer) => {
        if (active) setUser(customer);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setError(
            "We couldn’t check your account. Please reload to try again.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Checking your account…</p>;
  if (loadFailed)
    return (
      <>
        <h2>Your STREET account</h2>
        <p role="alert">{error}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </>
    );
  if (user)
    return (
      <section className="customer-panel account-content">
        <h2>Hello{user.firstName ? `, ${user.firstName}` : ""}</h2>
        <p>Your STREET account details.</p>
        <dl className="account-details">
          <dt>Phone</dt>
          <dd>{user.phone || "Not provided"}</dd>
          <dt>Email</dt>
          <dd>{user.email || "Not provided"}</dd>
        </dl>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await sessionRequest("logout", {});
              setUser(null);
              setCode("");
              setSent(false);
            })
          }
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </section>
    );
  return (
    <CustomerEmptyState
      icon="profile"
      title={sent ? "Check your phone" : "Your STREET account"}
      message={
        sent
          ? `Enter the code sent to ${phone}.`
          : "Sign in or join with the same phone number you use in the STREET app."
      }
    >
      <div className="account-content">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (sent) {
                const result = await sessionRequest("verify-otp", {
                  phone,
                  code,
                });
                setUser(result.user ?? null);
                setCode("");
              } else {
                await sessionRequest("request-otp", { phone });
                setSent(true);
              }
            });
          }}
        >
          {sent ? (
            <label>
              Verification code
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                pattern="[0-9]{4,6}"
                maxLength={6}
                required
                disabled={busy}
              />
            </label>
          ) : (
            <label>
              Phone number
              <input
                type="tel"
                autoComplete="tel"
                placeholder="+44 7700 900000"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={24}
                required
                disabled={busy}
                aria-describedby="phone-help"
              />
              <small id="phone-help">
                Include the country code, such as +44.
              </small>
            </label>
          )}
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <button className="primary wide" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : sent
                ? "Verify and continue"
                : "Send me a code"}
          </button>
        </form>
        {sent && (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode("");
              setError("");
            }}
          >
            Change number or request another code
          </button>
        )}
        <p className="account-note">
          This connects to STREET staging. Requesting a code sends a text
          message to the number you enter.
        </p>
      </div>
    </CustomerEmptyState>
  );
}

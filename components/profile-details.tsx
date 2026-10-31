"use client";
import { useRef, useState } from "react";
import type { Customer } from "../lib/contracts";
import { profilePermissions, type ProfileChanges } from "../lib/profile";
import { postAccountData } from "../lib/client/session";

export default function ProfileDetails({
  user,
  onSaved,
}: {
  user: Customer;
  onSaved: (user: Customer) => void;
}) {
  const [values, setValues] = useState({
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
  });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const permissions = profilePermissions(user);
  const fields = [
    {
      key: "firstName",
      label: "First name",
      autoComplete: "given-name",
      type: "text",
      editable: true,
    },
    {
      key: "lastName",
      label: "Last name",
      autoComplete: "family-name",
      type: "text",
      editable: true,
    },
    {
      key: "email",
      label: "Email address",
      autoComplete: "email",
      type: "email",
      editable: permissions.email,
    },
    {
      key: "phone",
      label: "Mobile number",
      autoComplete: "tel",
      type: "tel",
      editable: permissions.phone,
    },
  ] as const;
  const changes: ProfileChanges = {};
  for (const field of fields)
    if (field.editable && values[field.key].trim() !== (user[field.key] ?? ""))
      changes[field.key] = values[field.key].trim();
  return (
    <section className="profile-section account-content">
      <h2>Personal details</h2>
      <p>The same account, on the website and in the STREET app.</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || !Object.keys(changes).length) return;
          pending.current = true;
          setBusy(true);
          setError("");
          setMessage("");
          try {
            const result = await postAccountData<{ user: Customer }>(
              "/api/profile",
              changes,
            );
            onSaved(result.user);
            setValues({
              firstName: result.user.firstName ?? "",
              lastName: result.user.lastName ?? "",
              email: result.user.email ?? "",
              phone: result.user.phone ?? "",
            });
            setMessage("Your details have been saved.");
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Unable to save your details. Please try again.",
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="profile-fields">
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                name={field.key}
                type={field.type}
                autoComplete={field.autoComplete}
                value={values[field.key]}
                disabled={!field.editable || busy}
                maxLength={
                  field.key === "email" ? 254 : field.key === "phone" ? 24 : 100
                }
                aria-describedby={
                  field.key === "phone" || !field.editable
                    ? `profile-${field.key}-help`
                    : undefined
                }
                onChange={(e) => {
                  setValues({ ...values, [field.key]: e.target.value });
                  setMessage("");
                }}
              />
              {field.key === "phone" && (
                <small id="profile-phone-help">
                  {permissions.phone
                    ? "Include the country code, such as +44."
                    : "Your mobile number is used to sign in."}
                </small>
              )}
              {field.key === "email" && !permissions.email && (
                <small id="profile-email-help">
                  Your email address is managed by Google.
                </small>
              )}
            </label>
          ))}
        </div>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <p role="status">{message}</p>
        <button
          className="primary"
          disabled={busy || !Object.keys(changes).length}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </section>
  );
}

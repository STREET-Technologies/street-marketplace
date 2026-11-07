"use client";
import { useEffect, useRef, useState } from "react";
import type { SavedAddress } from "../lib/contracts";
import { addressLabels, type AddressFields } from "../lib/profile";
import { postAccountData } from "../lib/client/session";
import { useCustomer } from "./customer-context";
import AddressSearch from "./address-search";
import NavigationIcon from "./navigation-icon";
import { CustomerEmptyState } from "./customer-page";

const addressInputs = [
  { key: "line1", label: "Address line 1", autoComplete: "address-line1" },
  {
    key: "line2",
    label: "Address line 2 (optional)",
    autoComplete: "address-line2",
  },
  { key: "city", label: "Town or city", autoComplete: "address-level2" },
  { key: "state", label: "County or region", autoComplete: "address-level1" },
  { key: "postcode", label: "Postcode", autoComplete: "postal-code" },
] as const;

function AddressForm({
  address,
  busy,
  onSave,
  onCancel,
}: {
  address: SavedAddress | null;
  busy: boolean;
  onSave: (value: AddressFields & { isDefault: boolean }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<AddressFields & { isDefault: boolean }>({
    label:
      addressLabels.find((label) => label === address?.label) ??
      (address ? "" : "Home"),
    isDefault: address?.isDefault ?? false,
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    postcode: address?.postcode ?? "",
    deliveryInstructions: address?.deliveryInstructions ?? "",
  });
  const line1Input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="account-content address-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <h3>{address ? "Edit address" : "Add an address"}</h3>
      <AddressSearch purpose="profile" disabled={busy} onSelect={(result) => {
        setValue((previous) => ({
          ...previous,
          line1: result.line1,
          line2: "",
          city: result.city,
          state: result.state,
          postcode: result.postcode,
        }));
        line1Input.current?.focus();
      }} />
      <p>Choose an address above or enter it below.</p>
      <fieldset className="address-label-options" disabled={busy}>
        <legend>Address name</legend>
        <div>
          {addressLabels.map((label) => (
            <label key={label}>
              <input
                type="radio"
                name="address-label"
                value={label}
                checked={value.label === label}
                required
                onChange={() => setValue({ ...value, label })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="profile-fields">
        {addressInputs.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              ref={field.key === "line1" ? line1Input : undefined}
              name={field.key}
              autoComplete={field.autoComplete}
              value={value[field.key]}
              onChange={(e) =>
                setValue({ ...value, [field.key]: e.target.value })
              }
              required={field.key !== "line2"}
              disabled={busy}
              maxLength={
                field.key === "postcode"
                  ? 12
                  : field.key === "line1" || field.key === "line2"
                    ? 200
                    : 100
              }
            />
          </label>
        ))}
        <label className="profile-field-wide">
          Delivery instructions (optional)
          <textarea
            name="deliveryInstructions"
            rows={3}
            maxLength={500}
            disabled={busy}
            value={value.deliveryInstructions}
            onChange={(e) =>
              setValue({ ...value, deliveryInstructions: e.target.value })
            }
          />
        </label>
      </div>
      <label className="address-default-option">
        <input
          type="checkbox"
          checked={value.isDefault}
          disabled={busy || !!address?.isDefault}
          onChange={(event) =>
            setValue({ ...value, isDefault: event.target.checked })
          }
        />
        <span>Set as default address</span>
      </label>
      <div className="profile-actions">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save address"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ProfileAddresses({ resetRequest = 0 }: { resetRequest?: number }) {
  const { state, refresh } = useCustomer();
  const [editing, setEditing] = useState<SavedAddress | null | undefined>(
    undefined,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    // Do not interrupt a submitted save or allow a second mutation while it finishes.
    if (pending.current) return;
    setEditing(undefined);
    setRemoving(null);
    setError("");
    setMessage("");
  }, [resetRequest]);
  async function change(body: unknown, success: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await postAccountData<{ warning?: string }>(
        "/api/addresses/change",
        body,
      );
      setEditing(undefined);
      setRemoving(null);
      setMessage(result.warning ?? success);
      refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to update your addresses. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="profile-section">
      <div>
        <div className="profile-heading-title">
          <h2>My addresses</h2>
          {editing === undefined &&
            state.status === "ready" &&
            !!state.data?.addresses.length && (
              <button
                className="profile-heading-action"
                aria-label="Add address"
                title="Add address"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setError("");
                  setMessage("");
                  setRemoving(null);
                }}
              >
                <NavigationIcon name="plus" />
              </button>
            )}
        </div>
        <p>Your saved addresses, shared with the STREET app.</p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
      {editing !== undefined ? (
        <AddressForm
          key={editing?.id ?? "new"}
          address={editing}
          busy={busy}
          onCancel={() => {
            setEditing(undefined);
            setError("");
          }}
          onSave={(value) =>
            void change(
              {
                action: "save",
                ...(editing ? { id: editing.id } : {}),
                ...value,
              },
              "Your address has been saved.",
            )
          }
        />
      ) : (
        <>
          {state.status === "loading" && (
            <p role="status">Loading addresses…</p>
          )}
          {state.status === "error" && (
            <p role="alert">
              {state.error}{" "}
              <button className="text-link" onClick={refresh}>
                Try again
              </button>
            </p>
          )}
          {state.status === "guest" && (
            <p>
              Your session has ended.{" "}
              <button
                className="text-link"
                onClick={() => window.location.reload()}
              >
                Sign in again
              </button>
            </p>
          )}
          {state.status === "ready" && !state.data?.addresses.length && (
            <CustomerEmptyState
              icon="location"
              title="No addresses saved"
              message="Add your first address to get started"
            >
              <button
                className="primary"
                onClick={() => {
                  setEditing(null);
                  setMessage("");
                }}
              >
                Add address
              </button>
            </CustomerEmptyState>
          )}
          {state.status === "ready" && (
            <div className="profile-address-list">
              {state.data?.addresses.map((address) => (
                <article key={address.id} className="profile-address">
                  <div>
                    <h3>
                      {address.label}{" "}
                      {address.isDefault && (
                        <span className="profile-default">Default</span>
                      )}
                    </h3>
                    <p>
                      {[
                        address.line1,
                        address.line2,
                        address.city,
                        address.postcode,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    {address.deliveryInstructions && (
                      <p className="profile-instructions">
                        {address.deliveryInstructions}
                      </p>
                    )}
                  </div>
                  {removing === address.id ? (
                    <div
                      className="profile-remove"
                      role="group"
                      aria-label={`Remove ${address.label}`}
                    >
                      <p>
                        Remove this address from your STREET account?
                        {address.isDefault
                          ? " You’ll need to choose another default address."
                          : ""}
                      </p>
                      <div className="profile-actions">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void change(
                              { action: "delete", id: address.id },
                              "Your address has been removed.",
                            )
                          }
                        >
                          {busy ? "Removing…" : "Remove address"}
                        </button>
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => setRemoving(null)}
                        >
                          Keep address
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="profile-actions">
                      <button
                        className="text-link"
                        disabled={busy}
                        aria-label={`Edit ${address.label}`}
                        onClick={() => {
                          setEditing(address);
                          setError("");
                          setMessage("");
                        }}
                      >
                        Edit
                      </button>
                      {!address.isDefault && (
                        <button
                          className="text-link"
                          disabled={busy}
                          aria-label={`Make ${address.label} default`}
                          onClick={() =>
                            void change(
                              { action: "default", id: address.id },
                              "Your default address has been updated.",
                            )
                          }
                        >
                          Make default
                        </button>
                      )}
                      <button
                        className="text-link"
                        disabled={busy}
                        aria-label={`Remove ${address.label}`}
                        onClick={() => {
                          setRemoving(address.id);
                          setError("");
                          setMessage("");
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

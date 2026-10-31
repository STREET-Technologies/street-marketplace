"use client";
import NavigationIcon from "./navigation-icon";
import Link from "next/link";
import {
  startTransition,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type {
  CustomerContext as Data,
  FavouriteTarget,
  SavedAddress,
  DeliveryCheck,
} from "../lib/contracts";
import {
  currentCustomer,
  readAccountData,
  changeFavourite,
  SessionError,
} from "../lib/client/session";
const key = (target: FavouriteTarget) =>
  JSON.stringify([
    target.kind,
    target.vendorId,
    target.kind === "product" ? target.productId : target.outletId,
  ]);
type State = {
  status: "loading" | "guest" | "ready" | "error";
  data?: Data;
  error?: string;
};
export type Coordinates = { latitude: number; longitude: number };
type Context = {
  coordinates: Coordinates | null;
  currentPostcode: string | null;
  useDeviceLocation: (coordinates: Coordinates) => void;
  state: State;
  selected: SavedAddress | null;
  select: (id: string | null) => void;
  refresh: () => void;
  pending: string | null;
  toggle: (target: FavouriteTarget) => Promise<void>;
};
const Customer = createContext<Context | null>(null);
export const useCustomer = () => {
  const context = useContext(Customer);
  if (!context) throw new Error("Customer provider missing");
  return context;
};
export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [addressId, setAddressId] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [postcodeResult, setPostcodeResult] = useState<{
    coordinates: Coordinates;
    postcode: string | null;
  } | null>(null);
  useEffect(() => {
    if (!coordinates) return;
    const controller = new AbortController();
    fetch("/api/location/postcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coordinates),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!controller.signal.aborted)
          setPostcodeResult({
            coordinates,
            postcode: typeof data?.postcode === "string" ? data.postcode : null,
          });
      })
      .catch(() => {
        /* Coordinates remain usable if the label lookup fails. */
      });
    return () => controller.abort();
  }, [coordinates]);

  const [pending, setPending] = useState<string | null>(null);
  const needsRefresh = useRef(false);
  const epoch = useRef(0),
    busy = useRef(false),
    userId = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (busy.current) {
      needsRefresh.current = true;
      return;
    }
    const version = ++epoch.current;
    startTransition(() => setState({ status: "loading" }));
    try {
      const user = await currentCustomer();
      const data = user
        ? await readAccountData<Data>(
            "/api/customer-context",
            new URLSearchParams(),
          )
        : undefined;
      if (version !== epoch.current) return;
      if (userId.current !== (data?.userId ?? null)) setAddressId(null);
      userId.current = data?.userId ?? null;
      if (!data) setAddressId(null);
      else
        setAddressId((id) =>
          data.addresses.some((a) => a.id === id && a.coordinates) ? id : null,
        );
      startTransition(() =>
        setState(data ? { status: "ready", data } : { status: "guest" }),
      );
    } catch (error) {
      if (version !== epoch.current) return;
      if (error instanceof SessionError && error.status === 401) {
        setAddressId(null);
        userId.current = null;
        startTransition(() => setState({ status: "guest" }));
      } else
        startTransition(() =>
          setState({
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Your account could not be loaded.",
          }),
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    const sessionChanged = () => {
      epoch.current++;
      setCoordinates(null);
      setAddressId(null);
      setState({ status: "loading" });
      void refresh();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("street:session-changed", sessionChanged);
    return () => {
      epoch.current++;
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("street:session-changed", sessionChanged);
    };
  }, [refresh]);
  const toggle = async (target: FavouriteTarget) => {
    if (busy.current || !state.data || state.status !== "ready") return;
    busy.current = true;
    const version = ++epoch.current;
    setPending(key(target));
    const saved = !state.data.favourites.some((f) => key(f) === key(target));
    try {
      await changeFavourite(target, saved);
      if (version === epoch.current)
        setState((previous) =>
          previous.data
            ? {
                ...previous,
                data: {
                  ...previous.data,
                  favourites: [
                    ...previous.data.favourites.filter(
                      (f) => key(f) !== key(target),
                    ),
                    ...(saved ? [target] : []),
                  ],
                },
              }
            : previous,
        );
      window.dispatchEvent(new Event("street:favourites-changed"));
    } catch (error) {
      if (error instanceof SessionError && error.status === 401) {
        setAddressId(null);
        userId.current = null;
        setState({ status: "guest" });
      }
      throw error;
    } finally {
      busy.current = false;
      setPending(null);
      if (needsRefresh.current) {
        needsRefresh.current = false;
        void refresh();
      }
    }
  };
  const selected =
    state.status === "ready"
      ? (state.data?.addresses.find((a) => a.id === addressId) ?? null)
      : null;
  return (
    <Customer.Provider
      value={{
        state,
        selected,
        coordinates,
        currentPostcode:
          postcodeResult?.coordinates === coordinates
            ? postcodeResult.postcode
            : null,
        select: (id) => {
          setCoordinates(null);
          setAddressId(id);
        },
        useDeviceLocation: (value) => {
          setAddressId(null);
          setCoordinates(value);
        },
        refresh,
        pending,
        toggle,
      }}
    >
      {children}
    </Customer.Provider>
  );
}
export function FavouriteButton({
  target,
  appearance = "inline",
  name = "this item",
}: {
  target: FavouriteTarget;
  appearance?: "inline" | "card" | "icon";
  name?: string;
}) {
  const { state, pending, toggle, refresh } = useCustomer();
  const [error, setError] = useState("");
  const saved =
    state.data?.favourites.some((f) => key(f) === key(target)) ?? false;
  const label =
    pending === key(target)
      ? "Updating wishlist…"
      : state.status === "loading"
        ? "Loading wishlist…"
        : saved
          ? `Remove ${name} from wishlist`
          : `Add ${name} to wishlist`;
  const heart = <NavigationIcon name="heart" filled={saved} />;
  const buttonClass = `favourite-action ${appearance !== "inline" ? "favourite-heart" : "text-link"}`;
  return (
    <div className={`favourite-control favourite-control--${appearance}`}>
      {state.status === "guest" ? (
        <Link
          className={buttonClass}
          href="/account"
          aria-label={`Sign in to add ${name} to wishlist`}
        >
          {heart}
          {appearance === "inline" && "Sign in to save"}
        </Link>
      ) : state.status === "error" ? (
        <button
          className={buttonClass}
          onClick={refresh}
          aria-label="Reload wishlist"
        >
          {heart}
          {appearance === "inline" && "Reload wishlist"}
        </button>
      ) : (
        <button
          className={buttonClass}
          disabled={state.status !== "ready" || pending !== null}
          aria-pressed={saved}
          aria-label={label}
          aria-busy={pending === key(target)}
          onClick={async () => {
            setError("");
            try {
              await toggle(target);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Unable to update your wishlist.",
              );
            }
          }}
        >
          {heart}
          {appearance === "inline" && <span>{label}</span>}
        </button>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            className="text-link"
            onClick={() => {
              setError("");
              refresh();
            }}
          >
            Refresh wishlist
          </button>
        </p>
      )}
    </div>
  );
}
export function SavedAddressOptions({ onSelect }: { onSelect: () => void }) {
  const { state, selected, select, refresh } = useCustomer();
  return (
    <div className="address-panel">
      <h2>Your saved addresses</h2>
      <p>
        Use an address from your STREET account to see nearby shops. This does
        not change your default address.
      </p>
      {state.status === "loading" && <p role="status">Loading addresses…</p>}
      {state.status === "guest" && (
        <Link className="text-link" href="/account">
          Sign in to choose an address
        </Link>
      )}
      {state.status === "error" && (
        <p role="alert">
          {state.error}{" "}
          <button className="text-link" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {state.status === "ready" && (
        <>
          {!state.data?.addresses.length && (
            <p>
              No saved addresses yet. <Link href="/account" onClick={onSelect}>Add an address in Profile</Link>.
            </p>
          )}
          <div className="address-options">
            {state.data?.addresses.map((a) => (
              <button
                className="address-option"
                key={a.id}
                disabled={!a.coordinates}
                aria-pressed={selected?.id === a.id}
                onClick={() => {
                  select(a.id);
                  onSelect();
                }}
              >
                <strong>
                  {a.label}
                  {selected?.id === a.id ? " · Selected ✓" : ""}
                  {a.isDefault ? " · Account default" : ""}
                </strong>
                <span>
                  {[a.line1, a.line2, a.city, a.postcode]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {!a.coordinates && (
                  <span>
                    Location missing — update this address in the app.
                  </span>
                )}
              </button>
            ))}
          </div>
          <button className="text-link" onClick={refresh}>
            Refresh addresses
          </button>
          {selected && (
            <button
              className="text-link"
              onClick={() => {
                select(null);
                onSelect();
              }}
            >
              Clear selected address
            </button>
          )}
        </>
      )}
    </div>
  );
}
export function DeliveryStatus({
  vendorId,
  outletId,
}: {
  vendorId: string;
  outletId: string;
}) {
  const { selected } = useCustomer();
  const [result, setResult] = useState<{
    key: string;
    data?: DeliveryCheck;
    error?: string;
  }>({ key: "" });
  const [revision, retry] = useState(0);
  const query = new URLSearchParams({
    vendorId,
    outletId,
    addressId: selected?.id ?? "",
  }).toString();
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setResult({ key: query });
    readAccountData<DeliveryCheck>(
      "/api/delivery-check",
      new URLSearchParams(query),
    )
      .then((data) => {
        if (active) setResult({ key: query, data });
      })
      .catch((error) => {
        if (active)
          setResult({
            key: query,
            error: error.message || "Delivery area could not be checked.",
          });
      });
    return () => {
      active = false;
    };
  }, [query, Boolean(selected), revision]);
  if (!selected)
    return (
      <p className="delivery-status">
        Choose a saved address above to check this shop’s service area.
      </p>
    );
  const current = result.key === query ? result : { key: query };
  return (
    <div className="delivery-status" role="status">
      {current.error ? (
        <p>
          {current.error}{" "}
          <button className="text-link" onClick={() => retry((v) => v + 1)}>
            Retry area check
          </button>
        </p>
      ) : !current.data ? (
        <p>Checking this shop for {selected.postcode}…</p>
      ) : (
        <p>
          {current.data.status === "available"
            ? `This shop serves the area around ${selected.postcode}. ${current.data.isOpen === true ? "Open now." : current.data.isOpen === false ? "Currently closed." : "Opening status unavailable."}`
            : current.data.status === "unavailable"
              ? `This shop is not currently listed for ${selected.postcode}. It may be outside the service area or unavailable.`
              : "The service-area check could not be completed."}{" "}
          This is an area check, not a confirmed delivery. Checkout remains
          disabled.
        </p>
      )}
    </div>
  );
}

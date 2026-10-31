"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import HeaderActions from "./header-actions";
import { SavedAddressOptions, useCustomer } from "./customer-context";

export default function MarketplaceHeader() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { selected, coordinates, select, useDeviceLocation } = useCustomer();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const view = pathname === "/" ? params.get("view") || "discover" : null;
  const location = selected
    ? `${selected.label} · ${selected.postcode}`
    : coordinates
      ? "Current location"
      : "Choose location";
  const resetPage = () => {
    if (pathname === "/" && params.has("page")) {
      const next = new URLSearchParams(params);
      next.delete("page");
      router.replace(`/?${next}`, { scroll: false });
    }
  };
  const close = () => {
    request.current++;
    setLocating(false);
    dialog.current?.close();
  };
  const chooseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError(
        "This browser cannot find your location. Choose a saved address instead.",
      );
      return;
    }
    const version = ++request.current;
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (version !== request.current || !dialog.current?.open) return;
        useDeviceLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        resetPage();
        close();
      },
      () => {
        if (version !== request.current || !dialog.current?.open) return;
        setLocating(false);
        setError(
          "We couldn’t find your location. Allow location access and try again, or choose a saved address.",
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };
  return (
    <>
      <div className="marketplace-header">
        <header className="header frame">
          <Link className="wordmark" href="/" aria-label="Street home">
            STREET
          </Link>
          <span className="header-divider" />
          <button
            id="location-trigger"
            className="location-button"
            aria-haspopup="dialog"
            aria-controls="location-picker"
            onClick={() => {
              setError("");
              dialog.current?.showModal();
            }}
          >
            <span>
              <small>Search near</small>
              <b>{location}</b>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <form
            className="search-form"
            action="/"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const query = String(
                new FormData(event.currentTarget).get("query") || "",
              ).trim();
              if (query)
                router.push(
                  `/?${new URLSearchParams({ view: "search", query })}`,
                );
            }}
          >
            <input type="hidden" name="view" value="search" />
            <label className="sr-only" htmlFor="search">
              Search products
            </label>
            <input
              id="search"
              name="query"
              key={params.get("query") || ""}
              defaultValue={params.get("query") || ""}
              maxLength={120}
              placeholder="Find your next good find"
              required
            />
            <button type="submit">Search</button>
          </form>
          <HeaderActions />
        </header>
        <div className="nav-line">
          <nav className="frame nav" aria-label="Main navigation">
            <div>
              {[
                ["discover", "Discover"],
                ["shops", "Shop all"],
                ["neighbourhoods", "Neighbourhoods"],
              ].map(([key, name]) => (
                <Link
                  key={key}
                  href={key === "discover" ? "/" : `/?view=${key}`}
                  className={view === key ? "active" : ""}
                  aria-current={view === key ? "page" : undefined}
                >
                  {name}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </div>
      <dialog
        ref={dialog}
        id="location-picker"
        className="location-picker"
        aria-labelledby="location-title"
        onCancel={close}
        onClose={() => {
          request.current++;
          setLocating(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }
        }}
      >
        <div className="location-picker-heading">
          <h2 id="location-title">Where are you shopping?</h2>
          <button
            className="text-link"
            onClick={close}
            aria-label="Close location picker"
          >
            Close
          </button>
        </div>
        <p>Find products near your current location or a saved address.</p>
        <button
          className="current-location-option"
          disabled={locating}
          aria-pressed={!!coordinates}
          onClick={chooseCurrentLocation}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
          </svg>
          {locating ? "Finding your location…" : "Use my current location"}
          {coordinates && !locating && <span>Selected</span>}
        </button>
        {error && <p role="alert">{error}</p>}
        {locating && (
          <p className="sr-only" role="status">
            Finding your location…
          </p>
        )}
        <SavedAddressOptions
          onSelect={() => {
            resetPage();
            close();
          }}
        />
        {coordinates && (
          <button
            className="text-link"
            onClick={() => {
              select(null);
              resetPage();
              close();
            }}
          >
            Clear current location
          </button>
        )}
        <p className="location-picker-note">
          This sets your browsing area. Delivery eligibility is checked
          separately using a saved address.
        </p>
      </dialog>
    </>
  );
}

"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  addressSearchMaxLength,
  addressSearchMinLength,
  type AddressSearchPurpose,
  type AddressSearchResult,
} from "../lib/address-search";
import NavigationIcon from "./navigation-icon";

export default function AddressSearch({
  purpose,
  disabled = false,
  onSelect,
}: {
  purpose: AddressSearchPurpose;
  disabled?: boolean;
  onSelect: (result: AddressSearchResult) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{
    query: string;
    status: "loading" | "ready" | "error";
    results: AddressSearchResult[];
  }>({ query: "", status: "ready", results: [] });
  const searching = focused && !chosen && !disabled && query.trim().length >= addressSearchMinLength;
  const status = response.query === query ? response.status : "loading";
  const results = response.query === query ? response.results : [];
  const expanded = searching && status === "ready" && results.length > 0;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResponse({ query, status: "loading", results: [] });
      setActive(-1);
      try {
        const result = await fetch("/api/location/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, purpose }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!result.ok) throw new Error();
        const data = await result.json();
        if (!Array.isArray(data.results)) throw new Error();
        if (!controller.signal.aborted)
          setResponse({ query, status: "ready", results: data.results });
      } catch {
        if (!controller.signal.aborted)
          setResponse({ query, status: "error", results: [] });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, purpose, searching, retry]);

  useEffect(() => {
    if (expanded && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  const choose = (result: AddressSearchResult) => {
    setChosen(true);
    setQuery(result.label);
    setActive(-1);
    onSelect(result);
  };

  return (
    <div className="address-search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <label className="sr-only" htmlFor={id}>Search postcode or address</label>
      <div className="address-search-input">
        <NavigationIcon name="search" />
        <input
          ref={input}
          id={id}
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search postcode or address"
          value={query}
          disabled={disabled}
          maxLength={addressSearchMaxLength}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-results` : undefined}
          aria-activedescendant={expanded && active >= 0 ? `${id}-result-${active}` : undefined}
          aria-describedby={searching ? `${id}-status` : undefined}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(false);
            setFocused(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searching) {
              event.preventDefault();
              event.stopPropagation();
              setFocused(false);
              setActive(-1);
            } else if (event.key === "Enter") {
              // Search never submits the surrounding address form.
              event.preventDefault();
              if (expanded) choose(results[active < 0 ? 0 : active]);
            } else if (expanded && ["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              setActive((index) => event.key === "ArrowDown"
                ? (index + 1) % results.length
                : (index <= 0 ? results.length : index) - 1);
            }
          }}
        />
        {query && (
          <button type="button" className="profile-heading-action" aria-label="Clear address search" disabled={disabled} onClick={() => {
            setQuery("");
            setChosen(false);
            setActive(-1);
            input.current?.focus();
          }}>
            <NavigationIcon name="close" />
          </button>
        )}
      </div>
      {searching && (
        <div className="address-search-feedback">
          <p id={`${id}-status`} role="status" className={expanded ? "sr-only" : undefined}>
            {status === "loading" ? "Searching addresses…" : status === "error"
              ? purpose === "profile"
                ? "Address search is unavailable. Try again or enter your address below."
                : "Address search is unavailable. Try again or use your current location."
              : results.length ? `${results.length} results. Use the arrow keys to choose an address.`
                : "No addresses found. Try another postcode or a street address."}
          </p>
          {status === "error" && <button type="button" className="text-link" onClick={() => {
            setResponse({ query, status: "loading", results: [] });
            setRetry((value) => value + 1);
          }}>Try again</button>}
          {expanded && (
            <>
              <ul ref={list} id={`${id}-results`} role="listbox" aria-label="Address suggestions" className="address-search-results">
                {results.map((result, index) => (
                  <li id={`${id}-result-${index}`} key={result.id} role="option" aria-selected={active === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(result)}>
                    <NavigationIcon name="location" />
                    <span>{result.label}</span>
                  </li>
                ))}
              </ul>
              <a className="address-search-attribution" href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">© Mapbox</a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

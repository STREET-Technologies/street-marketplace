"use client";

import Link from "next/link";
import { FavouriteButton } from "./customer-context";
import { useEffect, useState } from "react";
import type { Favourites, SavedItem, SavedPage } from "../lib/contracts";
import { readAccountData, SessionError } from "../lib/client/session";

type LoadState =
  | { status: "loading" | "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Favourites };

function SavedImage({ item }: { item: SavedItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="saved-image">
      {item.image && !failed ? (
        <img
          src={item.image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>Image unavailable</span>
      )}
    </div>
  );
}

function Collection({
  title,
  collection,
  kind,
  onPage,
}: {
  title: string;
  collection: SavedPage;
  kind: "products" | "shops";
  onPage: (page: number) => void;
}) {
  return (
    <section className="saved-collection" aria-label={title}>
      <div className="section-heading">
        <h2>{title}</h2>
        <span>{collection.total} saved</span>
      </div>
      {!collection.total ? (
        <p>
          You haven’t saved any{" "}
          {kind === "products" ? "products" : "shop locations"} yet.
        </p>
      ) : (
        <>
          <div className="saved-grid">
            {collection.items.map((item) => (
              <article key={item.key} className="saved-card">
                <SavedImage item={item} />
                <h3>{item.name}</h3>
                {item.productId ? (
                  <FavouriteButton
                    appearance="card"
                    name={item.name}
                    target={{
                      kind: "product",
                      vendorId: item.vendorId,
                      productId: item.productId,
                    }}
                  />
                ) : item.outletId ? (
                  <FavouriteButton
                    appearance="card"
                    name={item.name}
                    target={{
                      kind: "shop",
                      vendorId: item.vendorId,
                      outletId: item.outletId,
                    }}
                  />
                ) : null}
                {item.status === "ready" && (
                  <Link
                    className="text-link"
                    href={`/?${new URLSearchParams({ view: "shops", vendorId: item.vendorId, ...(item.productId ? { productId: item.productId } : {}), ...(item.outletId ? { outletId: item.outletId } : {}) })}`}
                  >
                    {item.productId
                      ? "Choose a shop location →"
                      : "Browse this shop location →"}
                  </Link>
                )}
                {item.shopName && <p>{item.shopName}</p>}
                {kind === "shops" && (
                  <p>Saved {item.outletId ? "shop location" : "shop"}</p>
                )}
                {item.status !== "ready" && (
                  <p className="saved-note">
                    {item.status === "unavailable"
                      ? "This item is no longer available in the catalogue."
                      : "Details couldn’t be loaded. Refresh to try again."}
                  </p>
                )}
              </article>
            ))}
          </div>
          {!collection.items.length && (
            <p>No saved items on this page. Return to the previous page.</p>
          )}
          {collection.totalPages > 1 && (
            <nav className="saved-pagination" aria-label={`${title} pages`}>
              <button
                className="secondary"
                disabled={collection.page <= 1}
                onClick={() => onPage(collection.page - 1)}
              >
                Previous
              </button>
              <span>
                Page {collection.page} of {collection.totalPages}
              </span>
              <button
                className="secondary"
                disabled={collection.page >= collection.totalPages}
                onClick={() => onPage(collection.page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

export default function Saved() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [productsPage, setProductsPage] = useState(1);
  const [shopsPage, setShopsPage] = useState(1);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setState({ status: "loading" });
      try {
        const data = await readAccountData<Favourites>(
          "/api/favourites",
          new URLSearchParams({
            productsPage: String(productsPage),
            shopsPage: String(shopsPage),
          }),
        );
        if (active) setState({ status: "ready", data });
      } catch (error) {
        if (active)
          setState(
            error instanceof SessionError && error.status === 401
              ? { status: "signed-out" }
              : {
                  status: "error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Your saved items could not be loaded.",
                },
          );
      } finally {
        pending = false;
      }
    }
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("street:favourites-changed", load);
    window.addEventListener("pageshow", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("street:favourites-changed", load);
      window.removeEventListener("pageshow", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [productsPage, shopsPage, revision]);
  return (
    <>
      <div className="saved-title">
        <div>
          <h1>Your favourites.</h1>
          <p>The products and shop locations saved to your STREET account.</p>
        </div>
        <button
          className="secondary"
          disabled={state.status === "loading"}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {state.status === "loading" && (
        <p role="status">Loading your saved items…</p>
      )}
      {state.status === "signed-out" && (
        <div className="saved-message">
          <h2>Keep your favourites together.</h2>
          <p>Sign in with the same phone number you use in the app.</p>
          <Link className="primary" href="/account">
            Sign in to STREET
          </Link>
        </div>
      )}
      {state.status === "error" && (
        <p role="alert">{state.message} Use Refresh to try again.</p>
      )}
      {state.status === "ready" && (
        <>
          <Collection
            title="Products"
            kind="products"
            collection={state.data.products}
            onPage={setProductsPage}
          />
          <Collection
            title="Shops"
            kind="shops"
            collection={state.data.shops}
            onPage={setShopsPage}
          />
          <p className="saved-note">
            Saved items are shared with the app. Choose a shop location to
            browse current products and availability. Purchasing is not enabled
            yet.
          </p>
        </>
      )}
    </>
  );
}

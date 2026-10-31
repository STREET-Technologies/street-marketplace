"use client";

import Link from "next/link";
import { CustomerEmptyState, CustomerSignIn } from "./customer-page";
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
        <CustomerEmptyState
          icon={kind === "products" ? "heart" : "store"}
          title={kind === "products" ? "No products saved" : "No stores saved"}
          message={
            kind === "products"
              ? "Products you save will appear here."
              : "Stores you save will appear here."
          }
        />
      ) : (
        <>
          <div className={`product-grid saved-grid saved-grid--${kind}`}>
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
            <nav className="catalogue-pagination" aria-label={`${title} pages`}>
              <button
                className="secondary pagination-previous"
                disabled={collection.page <= 1}
                onClick={() => onPage(collection.page - 1)}
              >
                Previous
              </button>
              <span>
                Page {collection.page} of {collection.totalPages}
              </span>
              <button
                className="secondary pagination-next"
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
  const [collection, setCollection] = useState<"products" | "shops">(
    "products",
  );
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
      {(state.status === "ready" || state.status === "error") && (
        <div className="customer-toolbar">
          <div
            className="saved-collection-switch"
            role="group"
            aria-label="Wishlist collections"
          >
            <button
              aria-pressed={collection === "products"}
              onClick={() => setCollection("products")}
            >
              Products
            </button>
            <button
              aria-pressed={collection === "shops"}
              onClick={() => setCollection("shops")}
            >
              Stores
            </button>
          </div>
          <button
            className="secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      )}
      {state.status === "loading" && (
        <p role="status">Loading your saved items…</p>
      )}
      {state.status === "signed-out" && (
        <CustomerSignIn
          icon="heart"
          title="Your wishlist"
          message="Sign in to keep track of the stores and items you love."
        />
      )}
      {state.status === "error" && (
        <p role="alert">{state.message} Use Refresh to try again.</p>
      )}
      {state.status === "ready" && (
        <Collection
          title={collection === "products" ? "Products" : "Stores"}
          kind={collection}
          collection={state.data[collection]}
          onPage={collection === "products" ? setProductsPage : setShopsPage}
        />
      )}
    </>
  );
}

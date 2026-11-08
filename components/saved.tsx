"use client";

import Link from "next/link";
import CustomerTabs from "./customer-tabs";
import NavigationIcon from "./navigation-icon";
import { CustomerEmptyState, CustomerSignIn, CustomerLoading } from "./customer-page";
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
  if (state.status === "signed-out")
    return (
      <CustomerSignIn
        icon="heart"
        title="Your wishlist"
        message="Sign in to keep track of the stores and items you love."
      />
    );
  return (
    <CustomerTabs
      sidebar
      label="Wishlist collections"
      value={collection}
      onChange={(key) => setCollection(key as "products" | "shops")}
      tabs={(["products", "shops"] as const).map((kind) => {
        const title = kind === "products" ? "Products" : "Stores";
        return {
          key: kind,
          label: title,
          content: kind === collection ? (
            <>
              <div className="saved-heading">
                <div className="profile-heading-title">
                  <h2>{title}</h2>
                  <button
                    className="profile-heading-action"
                    aria-label={`Refresh ${title.toLowerCase()}`}
                    title={`Refresh ${title.toLowerCase()}`}
                    disabled={state.status === "loading"}
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    <NavigationIcon name="refresh" />
                  </button>
                </div>
                {state.status === "ready" && (
                  <p className="saved-count" role="status">{state.data[kind].total} saved</p>
                )}
              </div>
              {state.status === "loading" && (
                <CustomerLoading label="Loading your saved items…">
                  <div className={`product-grid saved-grid saved-grid--${kind}`}>
                    {Array.from({ length: kind === "products" ? 10 : 8 }, (_, index) => (
                      <div key={index}>
                        <span className="saved-image skeleton-block" />
                        <div className="skeleton-copy">
                          <span className="skeleton-block skeleton-line skeleton-line--title" />
                          <span className="skeleton-block skeleton-line" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CustomerLoading>
              )}
              {state.status === "error" && (
                <p role="alert">{state.message} Use Refresh to try again.</p>
              )}
              {state.status === "ready" && (
                <Collection
                  title={title}
                  kind={kind}
                  collection={state.data[kind]}
                  onPage={kind === "products" ? setProductsPage : setShopsPage}
                />
              )}
            </>
          ) : null,
        };
      })}
    />
  );
}

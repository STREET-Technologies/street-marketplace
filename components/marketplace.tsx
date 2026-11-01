"use client";
import { stockLabel, productPriceSummary } from "../lib/product-presentation";
import { ProductOptions } from "./product-options";
import {
  buildOptionModel,
  defaultOptions,
  selectedOptionVariant,
  type OptionSelection,
} from "../lib/product-options";
import { AddToBag } from "./cart";
import { CustomerEmptyState } from "./customer-page";
import { FavouriteButton, useCustomer } from "./customer-context";
import { readAccountData } from "../lib/client/session";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OutletCard,
  ProductCard,
  ProductDetail,
  ProductPage,
  VendorPage,
} from "../lib/contracts";
import { areas } from "../model.mjs";

type Params = Record<string, string>;
function clearFilters(params: Params) {
  const next = { ...params };
  for (const key of ["category", "productType", "query", "page"])
    delete next[key];
  return next;
}
function href(params: Params) {
  return "/?" + new URLSearchParams(params);
}
const money = (amount: number | null) =>
  amount === null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(amount);
function useData<T>(url: string) {
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{ url: string; data?: T; error?: string }>(
    { url: "" },
  );
  useEffect(() => {
    const controller = new AbortController();
    setState({ url });
    const parsed = new URL(url, "https://marketplace.invalid");
    const load = parsed.searchParams.has("addressId")
      ? readAccountData<T>(
          parsed.pathname as "/api/catalogue/vendors" | "/api/catalogue/browse",
          parsed.searchParams,
        )
      : fetch(url, { cache: "no-store", signal: controller.signal }).then(
          async (response) => {
            const data = await response.json().catch(() => {
              throw new Error(
                "STREET could not load this collection. Please try again.",
              );
            });
            if (!response.ok)
              throw new Error(
                data.error || "STREET could not load this collection.",
              );
            return data as T;
          },
        );
    load
      .then((data) => {
        if (!controller.signal.aborted) setState({ url, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            url,
            error: error instanceof Error ? error.message : "Please try again.",
          });
      });
    return () => controller.abort();
  }, [url, revision]);
  return {
    ...(state.url === url ? state : { url }),
    retry: () => refresh((v) => v + 1),
  };
}
function LoadMessage({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div className="catalogue-message" role="alert">
      <p>{error}</p>
      <button className="secondary" onClick={retry}>
        Try again
      </button>
    </div>
  ) : (
    <p className="catalogue-message" role="status">
      Loading from STREET…
    </p>
  );
}
function Photo({ src, alt = "" }: { src: string | null; alt?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(src)} />
  ) : (
    <span className="image-unavailable">Image unavailable</span>
  );
}
function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: Params;
}) {
  if (totalPages <= 1 && page <= 1) return null;
  return (
    <nav className="catalogue-pagination" aria-label="Results pages">
      {page > 1 && (
        <Link
          className="secondary pagination-previous"
          href={href({ ...params, page: String(page - 1) })}
        >
          Previous
        </Link>
      )}
      <span>
        Page {page} of {Math.max(totalPages, 1)}
      </span>
      {page < totalPages && (
        <Link
          className="secondary pagination-next"
          href={href({ ...params, page: String(page + 1) })}
        >
          Next
        </Link>
      )}
    </nav>
  );
}
function outletParams(outlet: OutletCard): Params {
  return {
    view: "catalogue",
    vendorId: outlet.vendorId,
    outletId: outlet.outletId ?? "",
    locationGid: outlet.locationGid ?? "",
    shop: outlet.name,
    branch: outlet.outletName ?? "",
  };
}
function Shops({
  params,
  preview = false,
}: {
  params: Params;
  preview?: boolean;
}) {
  const { selected, coordinates } = useCustomer();
  const page = preview ? 1 : Number(params.page || 1);
  const query = new URLSearchParams({ page: String(page) });
  if (selected) query.set("addressId", selected.id);
  else if (coordinates) {
    query.set("latitude", String(coordinates.latitude));
    query.set("longitude", String(coordinates.longitude));
  }
  if (!preview && params.category) query.set("category", params.category);
  const state = useData<VendorPage>(`/api/catalogue/vendors?${query}`);
  const locationKey = selected?.id ?? JSON.stringify(coordinates);
  const [cached, setCached] = useState<{
    location: string;
    categories: string[];
  } | null>(null);
  useEffect(() => {
    if (state.data)
      setCached({ location: locationKey, categories: state.data.categories });
  }, [state.data, locationKey]);
  const categories =
    state.data?.categories ??
    (cached?.location === locationKey ? cached.categories : []);
  const filters = !preview && (
    <CategoryFilter
      categories={categories ?? []}
      filterKey="category"
      params={params}
    />
  );
  if (!state.data)
    return (
      <div className={preview ? undefined : "browse-layout"}>
        {filters}
        <div className="browse-results">
          <LoadMessage {...state} />
        </div>
      </div>
    );
  const outlets = params.vendorId
    ? state.data.outlets.filter(
        (o) =>
          o.vendorId === params.vendorId &&
          (!params.outletId || o.outletId === params.outletId),
      )
    : state.data.outlets;
  return (
    <div className={preview ? undefined : "browse-layout"}>
      {filters}
      <div className="browse-results">
        {!preview && (
          <div className="results-bar">
            <span>
              {state.data.total} shops
              {selected || coordinates ? " · Nearest first" : ""}
            </span>
          </div>
        )}
        {params.vendorId && (
          <p className="catalogue-message">
            Choose a listed shop location to check its catalogue and stock.
            Saved products do not specify a branch.
          </p>
        )}
        <div className="shop-list">
          {(preview ? outlets.slice(0, 3) : outlets).map((outlet) => {
            const destination = outletParams(outlet);
            if (params.productId) {
              destination.view = "product";
              destination.productId = params.productId;
            }
            return (
              <article
                className="shop-card"
                key={outlet.vendorId + outlet.outletId}
              >
                {outlet.locationGid && outlet.outletId ? (
                  <Link
                    className="shop-image-link"
                    href={href(destination)}
                    aria-label={`Explore ${outlet.name}${outlet.outletName ? `, ${outlet.outletName}` : ""}`}
                  >
                    <Photo src={outlet.image} />
                  </Link>
                ) : (
                  <Photo src={outlet.image} />
                )}
                <div>
                  <div className="shop-heading">
                    <div className="shop-name-row">
                      <h3>
                        {outlet.locationGid && outlet.outletId ? (
                          <Link
                            className="shop-name-link"
                            href={href(destination)}
                          >
                            {outlet.name}
                          </Link>
                        ) : (
                          outlet.name
                        )}
                      </h3>
                      {outlet.outletId && (
                        <FavouriteButton
                          appearance="icon"
                          name={outlet.name}
                          target={{
                            kind: "shop",
                            vendorId: outlet.vendorId,
                            outletId: outlet.outletId,
                          }}
                        />
                      )}
                    </div>
                    <ShopLogo src={outlet.logo} />
                  </div>
                  <p>
                    {[
                      outlet.outletName,
                      outlet.category,
                      !outlet.isOnline ? "Currently offline" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="shop-address">
                    {outlet.address || outlet.postcode ? (
                      <a
                        href={`https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: [outlet.name, outlet.address, outlet.postcode].filter(Boolean).join(", ") })}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View ${outlet.name}${outlet.outletName ? `, ${outlet.outletName}` : ""} on Google Maps (opens in a new tab)`}
                      >
                        {[outlet.address, outlet.postcode]
                          .filter(Boolean)
                          .join(", ")}
                      </a>
                    ) : (
                      <span>Address unavailable</span>
                    )}
                    {outlet.distanceMiles !== null && (
                      <span className="shop-distance">
                        {outlet.distanceMiles.toFixed(1)} miles
                      </span>
                    )}
                  </div>

                  {outlet.locationGid && outlet.outletId ? (
                    <Link className="text-link" href={href(destination)}>
                      Explore the shop →
                    </Link>
                  ) : (
                    <p>Products are not available for this location yet.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!outlets.length && (
          <CustomerEmptyState
            icon="store"
            title="No shops found"
            message={
              params.vendorId
                ? "This saved shop location isn’t listed here. Browse the available shops to keep exploring."
                : params.category
                  ? "No shops in this category were found for this location."
                  : "Try another location from the location menu above, or explore a neighbourhood."
            }
          >
            <Link
              className="primary"
              href={href(
                params.category || page > 1
                  ? clearFilters(params)
                  : { view: params.vendorId ? "shops" : "neighbourhoods" },
              )}
            >
              {params.category
                ? "Clear filters"
                : page > 1
                  ? "Back to first page"
                  : params.vendorId
                    ? "Browse shops"
                    : "Explore neighbourhoods"}
            </Link>
          </CustomerEmptyState>
        )}
        {!preview && (
          <Pagination
            page={page}
            totalPages={state.data.totalPages}
            params={params}
          />
        )}
      </div>
    </div>
  );
}
function ProductGrid({
  products,
  context,
}: {
  products: ProductCard[];
  context: Params;
}) {
  const [opened, setOpened] = useState<Params | null>(null);
  return (
    <div className="product-grid">
      {products.map((p, i) => {
        const productParams = {
          view: "product",
          vendorId: p.vendorId,
          productId: p.id ?? "",
          locationGid: p.locationGid ?? "",
          outletId: p.outletId ?? context.outletId ?? "",
          shop: p.shopName ?? context.shop ?? "",
          branch: p.outletName ?? context.branch ?? "",
        };
        const destination = href(productParams);
        const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          setOpened(productParams);
        };
        const ready = p.id && p.locationGid;
        return (
          <article className="product-card" key={`${p.id}-${p.outletId}-${i}`}>
            <div className="product-image">
              {ready ? (
                <Link
                  className="image-link"
                  href={destination}
                  onClick={open}
                  aria-label={`View ${p.title}`}
                >
                  <Photo src={p.image} />
                  <span className="product-view-label" aria-hidden="true">
                    View product
                  </span>
                </Link>
              ) : (
                <Photo src={p.image} />
              )}
            </div>
            <div className="product-info">
              {p.productType && (
                <small className="product-category">{p.productType}</small>
              )}
              <div>
                {ready ? (
                  <Link href={destination} onClick={open}>
                    {p.title}
                  </Link>
                ) : (
                  <span>{p.title}</span>
                )}
                <b>{money(p.price)}</b>
              </div>
              {context.view !== "catalogue" && (
                <span className="product-shop">
                  {p.shopName ?? context.shop}
                  {p.outletName ? ` · ${p.outletName}` : ""}
                </span>
              )}
              {!ready && <p>Product details unavailable</p>}
            </div>
            {p.id && (
              <FavouriteButton
                appearance="card"
                name={p.title}
                target={{
                  kind: "product",
                  vendorId: p.vendorId,
                  productId: p.id,
                }}
              />
            )}
          </article>
        );
      })}
      {opened && (
        <ProductOverlay params={opened} onClose={() => setOpened(null)} />
      )}
    </div>
  );
}
function CategoryFilter({
  categories,
  filterKey = "productType",
  params,
}: {
  categories: string[];
  filterKey?: "productType" | "category";
  params: Params;
}) {
  const row = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({
    overflow: false,
    start: true,
    end: true,
  });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () =>
      setEdges({
        overflow: element.scrollWidth > element.clientWidth + 1,
        start: element.scrollLeft <= 1,
        end:
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [categories]);
  useEffect(() => {
    const element = row.current,
      active = element?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!element || !active) return;
    if (getComputedStyle(element).flexDirection === "column") return;
    if (
      active.offsetLeft < element.scrollLeft ||
      active.offsetLeft + active.offsetWidth >
        element.scrollLeft + element.clientWidth
    )
      element.scrollTo({
        left:
          active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2,
      });
  }, [params, filterKey]);
  const scroll = (direction: number) =>
    row.current?.scrollBy({
      left: direction * row.current.clientWidth * 0.75,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <div className="category-strip" data-overflow={edges.overflow}>
      <h2 className="category-heading">Categories</h2>
      <nav
        ref={row}
        className="catalogue-categories"
        aria-label={
          filterKey === "category" ? "Shop categories" : "Product categories"
        }
        onKeyDown={(event) => {
          const vertical =
            getComputedStyle(event.currentTarget).flexDirection === "column";
          const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
          const nextKey = vertical ? "ArrowDown" : "ArrowRight";
          if (![previousKey, nextKey, "Home", "End"].includes(event.key))
            return;
          const links = Array.from(event.currentTarget.querySelectorAll("a"));
          const index = links.indexOf(event.target as HTMLAnchorElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? links.length - 1
                : Math.max(
                    0,
                    Math.min(
                      links.length - 1,
                      index + (event.key === nextKey ? 1 : -1),
                    ),
                  );
          links[next]?.focus({ preventScroll: true });
          const link = links[next];
          if (link && vertical) {
            const nav = event.currentTarget;
            if (link.offsetTop < nav.scrollTop) nav.scrollTop = link.offsetTop;
            else if (
              link.offsetTop + link.offsetHeight >
              nav.scrollTop + nav.clientHeight
            )
              nav.scrollTop =
                link.offsetTop + link.offsetHeight - nav.clientHeight;
          } else if (link)
            event.currentTarget.scrollTo({
              left:
                link.offsetLeft -
                (event.currentTarget.clientWidth - link.offsetWidth) / 2,
            });
        }}
      >
        {[
          { value: "", label: "All" },
          ...categories.map((value) => ({ value, label: value })),
        ].map((category) => {
          const next = { ...params };
          delete next.page;
          if (category.value) next[filterKey] = category.value;
          else delete next[filterKey];
          return (
            <Link
              key={category.value}
              href={href(next)}
              scroll={false}
              aria-current={
                (params[filterKey] || "") === category.value
                  ? "true"
                  : undefined
              }
            >
              <span>{category.label}</span>
              <svg
                className="category-selected"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          );
        })}
      </nav>

      <button
        className="category-scroll category-scroll--previous"
        aria-label="Previous categories"
        hidden={!edges.overflow || edges.start}
        onClick={() => scroll(-1)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m14 5-7 7 7 7" />
        </svg>
      </button>
      <button
        className="category-scroll category-scroll--next"
        aria-label="More categories"
        hidden={!edges.overflow || edges.end}
        onClick={() => scroll(1)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m10 5 7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
function ShopLogo({ src }: { src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return null;
  return (
    <img
      className="shop-logo"
      src={src}
      alt=""
      onError={() => setFailed(src)}
    />
  );
}
function Products({
  params,
  coordinates,
}: {
  params: Params;
  coordinates: Coordinates | null;
}) {
  const { selected } = useCustomer();
  const search = params.view === "search";
  const query = new URLSearchParams({
    kind: search ? "search" : "products",
    page: params.page || "1",
  });
  if (params.query) query.set("query", params.query);
  if (search && selected) query.set("addressId", selected.id);
  if (search && !selected && coordinates) {
    query.set("latitude", String(coordinates.latitude));
    query.set("longitude", String(coordinates.longitude));
  }
  if (!search) {
    if (params.productType) query.set("productType", params.productType);
    query.set("vendorId", params.vendorId || "");
    query.set("locationGid", params.locationGid || "");
  }
  const state = useData<ProductPage>(`/api/catalogue/browse?${query}`);
  const [cachedFacets, cacheFacets] = useState<ProductPage["facets"] | null>(
    null,
  );
  useEffect(() => {
    if (state.data && !search) cacheFacets(state.data.facets ?? []);
  }, [state.data, search]);
  const facets = state.data?.facets ?? cachedFacets;
  return (
    <section className="catalogue">
      <div className="catalogue-intro">
        <h1>
          {search
            ? `Finds for “${params.query || ""}”`
            : params.shop || "Shop collection"}
        </h1>
        <p>
          {search
            ? "Products at shop locations near your search location."
            : [
                params.branch,
                "Prices and availability from the selected shop location.",
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>
      <div className={search ? undefined : "browse-layout"}>
        {!search && (
          <CategoryFilter
            categories={(facets ?? []).map((f) => f.productType)}
            params={params}
          />
        )}
        <div className="browse-results">
          {!state.data ? (
            <LoadMessage {...state} />
          ) : state.data.requiresLocation ? (
            <CustomerEmptyState
              icon="location"
              title="Find products near you"
              message="Choose a saved address or use your current location from the location menu above."
            >
              <Link className="primary" href={href({ view: "shops" })}>
                Browse shops
              </Link>
            </CustomerEmptyState>
          ) : state.data.outOfDeliveryArea ? (
            <CustomerEmptyState
              icon="store"
              title="No shops nearby"
              message="Try another location from the location menu above, or explore a neighbourhood."
            >
              <Link className="primary" href={href({ view: "neighbourhoods" })}>
                Explore neighbourhoods
              </Link>
            </CustomerEmptyState>
          ) : (
            <>
              <div className="results-bar">
                <span>{state.data.total} products</span>
              </div>
              <ProductGrid products={state.data.products} context={params} />
              {!state.data.products.length && (
                <CustomerEmptyState
                  icon="search"
                  title="No products found"
                  message={
                    !search && (params.query || params.productType)
                      ? "Try clearing your filters to see more products."
                      : "Try another search or shop to find something you love."
                  }
                >
                  <Link
                    className="primary"
                    href={href(
                      !search &&
                        (params.query ||
                          params.productType ||
                          state.data.page > 1)
                        ? clearFilters(params)
                        : { view: "shops" },
                    )}
                  >
                    {!search && (params.query || params.productType)
                      ? "Clear filters"
                      : !search && state.data.page > 1
                        ? "Back to first page"
                        : "Browse shops"}
                  </Link>
                </CustomerEmptyState>
              )}
              <Pagination
                page={state.data.page}
                totalPages={state.data.totalPages}
                params={params}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
function ProductOverlay({
  params,
  onClose,
}: {
  params: Params;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="product-overlay"
      aria-label="Product details"
      onCancel={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={(event) => {
        if (event.target === event.currentTarget && !event.currentTarget.open)
          onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
    >
      <button
        className="modal-close"
        aria-label="Close product details"
        onClick={onClose}
        autoFocus
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M6 18 18 6" />
        </svg>
      </button>
      <Product params={params} overlay onShopNavigate={onClose} />
    </dialog>
  );
}
function ProductGallery({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [index, select] = useState(0);
  const gallery = useRef<HTMLDivElement>(null);
  const multiple = images.length > 1;
  const previewLimit = 5;
  const extraImages = Math.max(0, images.length - previewLimit);
  const move = (direction: number) =>
    select((current) => (current + direction + images.length) % images.length);
  useEffect(() => {
    if (images.length < 2) return;
    const element = gallery.current;
    const host = element?.closest("dialog") ?? element;
    if (!host) return;
    const onKey = (event: Event) => {
      const key = event as KeyboardEvent;
      const target = key.target as HTMLElement;
      if (
        key.altKey ||
        key.ctrlKey ||
        key.metaKey ||
        key.shiftKey ||
        target.closest(
          'input, textarea, select, [contenteditable="true"], .sizes',
        )
      )
        return;
      if (target.closest("dialog") !== element?.closest("dialog")) return;
      if (key.key !== "ArrowLeft" && key.key !== "ArrowRight") return;
      key.preventDefault();
      select(
        (current) =>
          (current + (key.key === "ArrowRight" ? 1 : -1) + images.length) %
          images.length,
      );
    };
    host.addEventListener("keydown", onKey);
    return () => host.removeEventListener("keydown", onKey);
  }, [images.length]);
  return (
    <div
      className="product-gallery"
      ref={gallery}
      role="region"
      aria-label={`${title} images`}
      tabIndex={multiple ? 0 : undefined}
    >
      <div className="gallery-stage">
        <Photo
          src={images[index] ?? null}
          alt={`${title}${multiple ? ` — image ${index + 1} of ${images.length}` : ""}`}
        />
        {multiple && (
          <>
            <button
              className="gallery-arrow gallery-arrow--previous"
              aria-label="Previous product image"
              onClick={() => move(-1)}
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
                <path d="m14 5-7 7 7 7" />
              </svg>
            </button>
            <button
              className="gallery-arrow gallery-arrow--next"
              aria-label="Next product image"
              onClick={() => move(1)}
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
                <path d="m10 5 7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>
      {multiple && (
        <>
          <p className="gallery-position" aria-live="polite" aria-atomic="true">
            {index + 1} / {images.length}
            <span className="sr-only">
              . Use Left and Right arrow keys to change image.
            </span>
          </p>
          <div
            className="gallery-choices"
            role="group"
            aria-label="Product image previews"
          >
            {images.slice(0, previewLimit).map((src, i) => (
              <button
                key={src + i}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={index === i}
                onClick={() => select(i)}
              >
                <Photo src={src} />
              </button>
            ))}
            {extraImages > 0 && (
              <button
                className="gallery-more"
                aria-label={`${extraImages} more images. Show image ${previewLimit + 1}`}
                aria-pressed={index >= previewLimit}
                onClick={() => select(previewLimit)}
              >
                +{extraImages}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function Product({
  params,
  overlay = false,
  onShopNavigate,
}: {
  params: Params;
  overlay?: boolean;
  onShopNavigate?: () => void;
}) {
  const query = new URLSearchParams({
    kind: "product",
    vendorId: params.vendorId || "",
    productId: params.productId || "",
    locationGid: params.locationGid || "",
  });
  const state = useData<ProductDetail>(`/api/catalogue/browse?${query}`);
  const [choice, setChoice] = useState<{
    key: string;
    values: OptionSelection;
    variantId: string;
  }>({ key: "", values: {}, variantId: "" });
  const product = state.data;
  const model = useMemo(
    () => (product ? buildOptionModel(product) : null),
    [product],
  );
  const choiceKey = query.toString();
  const values = model
    ? {
        ...defaultOptions(model),
        ...(choice.key === choiceKey ? choice.values : {}),
      }
    : {};
  const variantId = choice.key === choiceKey ? choice.variantId : "";
  const priceSummary = productPriceSummary(product?.variants ?? []);
  const selected = model
    ? selectedOptionVariant(model, values)
    : (product?.variants.find((v) => v.id === variantId) ??
      (product?.variants.length === 1 ? product.variants[0] : undefined));
  const back: Params = { ...params, view: "catalogue" };
  delete back.productId;
  return (
    <section className="section live-product">
      {!overlay && (
        <Link className="text-link" href={href(back)}>
          ← Back to {params.shop || "the shop"}
        </Link>
      )}
      {!product ? (
        <LoadMessage {...state} />
      ) : (
        <div className="product-detail">
          <ProductGallery images={product.images} title={product.title} />
          <div className="detail-copy">
            <Link
              className="text-link product-shop-link"
              href={href(back)}
              onNavigate={onShopNavigate}
            >
              {[params.shop, params.branch].filter(Boolean).join(" · ") ||
                "Browse this shop"}{" "}
              <span aria-hidden="true">→</span>
            </Link>
            <div className="product-title-row">
              {overlay ? <h2>{product.title}</h2> : <h1>{product.title}</h1>}
              <FavouriteButton
                appearance="icon"
                name={product.title}
                target={{
                  kind: "product",
                  vendorId: params.vendorId,
                  productId: product.id,
                }}
              />
            </div>
            <p className="detail-price">
              {selected
                ? money(selected.price)
                : `${priceSummary.from ? "From " : ""}${money(priceSummary.price)}`}
            </p>
            {product.description && (
              <p className="product-description">{product.description}</p>
            )}
            <ProductOptions
              product={product}
              model={model}
              values={values}
              selected={selected}
              onOptions={(values) =>
                setChoice({ key: choiceKey, values, variantId: "" })
              }
              onVariant={(variantId) =>
                setChoice({ key: choiceKey, values: {}, variantId })
              }
            />
            <p role="status" className="stock-status">
              {selected ? stockLabel(selected.inventory) : ""}
            </p>
            <AddToBag
              outlet={{
                vendorId: params.vendorId,
                outletId: params.outletId,
                shopName: params.shop || "Shop",
                branch: params.branch || "",
              }}
              product={product}
              variant={selected}
            />
          </div>
        </div>
      )}
    </section>
  );
}
function Hero() {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(preference.matches);
    const change = () => {
      if (preference.matches) setPaused(true);
    };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || failed) return;
    let visible = false,
      active = true;
    const update = () => {
      if (paused || !visible || document.hidden) element.pause();
      else
        void element.play().catch(() => {
          if (active && visible && !document.hidden) setPaused(true);
        });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        update();
      },
      { threshold: 0.05 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      element.pause();
    };
  }, [paused, failed]);
  return (
    <section className="hybrid-hero hybrid-hero--editorial">
      <div className="hero-copy">
        <h1>
          Your high <br />
          street. <br />
          <span>A little closer.</span>
        </h1>
        <p>
          The shops you love. The ones you’re yet to find.
          <br />A whole neighbourhood, at your fingertips.
        </p>
        <div className="hero-actions">
          <Link className="primary" href={href({ view: "shops" })}>
            Find your next good thing →
          </Link>
          <Link className="text-link" href={href({ view: "neighbourhoods" })}>
            Take a look around
          </Link>
        </div>
      </div>
      <div className="hero-photo hero-editorial">
        <img
          src="/assets/product-editorial-poster.jpg"
          alt="Illustrative fashion editorial"
          width="1280"
          height="720"
          fetchPriority="high"
        />
        {!failed && (
          <>
            <video
              ref={video}
              id="hero-video"
              muted
              loop
              playsInline
              preload="none"
              poster="/assets/product-editorial-poster.jpg"
              aria-label="Illustrative fashion, footwear, jewellery and fragrance editorial"
              onError={() => setFailed(true)}
            >
              <source src="/assets/product-editorial.mp4" type="video/mp4" />
            </video>
          </>
        )}
      </div>
      {!failed && (
        <button
          className="video-control"
          aria-controls="hero-video"
          aria-label={paused ? "Play video" : "Pause video"}
          onClick={() => setPaused((v) => !v)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {paused ? (
              <path d="M8 5v14l11-7Z" />
            ) : (
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            )}
          </svg>
        </button>
      )}
    </section>
  );
}
function AreaCards({
  exclude,
  carousel = false,
}: {
  exclude?: string;
  carousel?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const element = track.current;
    if (!carousel || !element) return;
    const update = () =>
      setEdges({
        start: element.scrollLeft <= 1,
        end:
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [carousel]);
  const move = (direction: number) => {
    const element = track.current;
    if (!element) return;
    const gap = parseFloat(getComputedStyle(element).columnGap);
    const pageWidth = element.clientWidth + gap;
    element.scrollTo({
      left:
        (Math.round(element.scrollLeft / pageWidth) + direction) * pageWidth,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };
  return (
    <>
      {carousel && (
        <div className="section-heading area-carousel-heading">
          <h2>Every street has a story.</h2>
          <div
            className="area-carousel-controls"
            aria-label="Neighbourhood carousel controls"
          >
            <button
              aria-label="Previous neighbourhoods"
              aria-controls="discover-neighbourhoods"
              disabled={edges.start}
              onClick={() => move(-1)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m14 5-7 7 7 7" />
              </svg>
            </button>
            <button
              aria-label="Next neighbourhoods"
              aria-controls="discover-neighbourhoods"
              disabled={edges.end}
              onClick={() => move(1)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m10 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div
        ref={track}
        id={carousel ? "discover-neighbourhoods" : undefined}
        className={`area-grid${carousel ? " area-carousel" : ""}`}
        role={carousel ? "region" : undefined}
        aria-label={carousel ? "Explore neighbourhoods" : undefined}
      >
        {areas.map((a, i) =>
          a.name === exclude ? null : (
            <Link
              className="area-card"
              key={a.name}
              href={href({ view: "area", area: String(i) })}
            >
              <img
                src={"/assets/" + a.image}
                alt={`A view of ${a.name}`}
                loading="lazy"
              />
              <div>
                <h3>{a.name}</h3>
                <span className="area-description">{a.line}</span>
                <svg
                  className="area-arrow"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 12h16m-6-6 6 6-6 6" />
                </svg>
              </div>
            </Link>
          ),
        )}
      </div>
    </>
  );
}
function Neighbourhood({ index }: { index: number }) {
  const area = areas[index] ?? areas[0];
  return (
    <>
      <section className="local-hero">
        <div className="local-photo">
          <img src={"/assets/" + area.image} alt={area.name} />
        </div>
        <div className="local-copy">
          <h1>{area.headline.join(" ")}</h1>
          <p>{area.intro}</p>
          <p className="area-note">
            An introduction to the area. Browse the full STREET collection
            below.
          </p>
          <Link className="secondary" href={href({ view: "shops" })}>
            Browse STREET shops →
          </Link>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Keep wandering.</h2>
        </div>
        <AreaCards exclude={area.name} />
      </section>
    </>
  );
}
import type { Coordinates } from "./customer-context";
export default function Marketplace() {
  const searchParams = useSearchParams();
  const params = Object.fromEntries(searchParams.entries());
  const view = params.view || "discover";
  const { coordinates } = useCustomer();
  return (
    <>
      <main id="main" className="frame live-marketplace">
        {view === "discover" && (
          <>
            <Hero />
            <section className="section">
              <div className="section-heading">
                <h2>Meet your next favourite.</h2>
                <Link className="text-link" href={href({ view: "shops" })}>
                  Browse all shops →
                </Link>
              </div>
              <Shops params={{}} preview />
            </section>
            <section className="section">
              <AreaCards carousel />
            </section>
          </>
        )}
        {view === "shops" && (
          <section className="catalogue">
            <div className="catalogue-intro">
              <h1>Shop all</h1>
            </div>
            <Shops params={params} />
          </section>
        )}
        {(view === "catalogue" || view === "search") && (
          <Products
            key={view + params.vendorId + params.locationGid}
            params={params}
            coordinates={coordinates}
          />
        )}
        {view === "product" && (
          <Product
            key={params.productId + params.locationGid}
            params={params}
          />
        )}
        {view === "neighbourhoods" && (
          <section className="section neighbourhood-intro">
            <h1>Where shall we wander?</h1>
            <p>
              Different streets. Different discoveries. Find your corner of
              London.
            </p>
            <AreaCards />
          </section>
        )}
        {view === "area" && <Neighbourhood index={Number(params.area)} />}
        {![
          "discover",
          "shops",
          "catalogue",
          "search",
          "product",
          "neighbourhoods",
          "area",
        ].includes(view) && (
          <section className="section">
            <h1>Let’s head back to the high street.</h1>
            <Link href="/">Discover STREET</Link>
          </section>
        )}
      </main>
    </>
  );
}

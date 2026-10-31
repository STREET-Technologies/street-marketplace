"use client";
import { AddToBag } from "./cart";
import {
  DeliveryStatus,
  FavouriteButton,
  useCustomer,
} from "./customer-context";
import { readAccountData } from "../lib/client/session";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  OutletCard,
  ProductCard,
  ProductDetail,
  ProductPage,
  VendorPage,
} from "../lib/contracts";
import { areas } from "../model.mjs";

type Params = Record<string, string>;
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
          className="secondary"
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
          className="secondary"
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
  const { selected } = useCustomer();
  const page = preview ? 1 : Number(params.page || 1);
  const state = useData<VendorPage>(
    `/api/catalogue/vendors?page=${page}${selected ? "&addressId=" + encodeURIComponent(selected.id) : ""}`,
  );
  if (!state.data) return <LoadMessage {...state} />;
  const outlets = params.vendorId
    ? state.data.outlets.filter(
        (o) =>
          o.vendorId === params.vendorId &&
          (!params.outletId || o.outletId === params.outletId),
      )
    : state.data.outlets;
  return (
    <>
      {params.vendorId && (
        <p className="catalogue-message">
          Choose a listed shop location to check its catalogue and stock. Saved
          products do not specify a branch.
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
              <Photo src={outlet.image} />
              <div>
                <h3>{outlet.name}</h3>
                <span className="shop-category">
                  {[outlet.outletName, outlet.postcode]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <p>
                  {outlet.category || "Explore the collection"} ·{" "}
                  {outlet.isOnline ? "Online" : "Currently offline"}
                </p>
                {outlet.outletId && (
                  <FavouriteButton
                    appearance="card"
                    name={outlet.name}
                    target={{
                      kind: "shop",
                      vendorId: outlet.vendorId,
                      outletId: outlet.outletId,
                    }}
                  />
                )}
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
        <p className="catalogue-message">
          {params.vendorId
            ? "This saved shop location is not listed on this page. Try another page, or browse the available shops."
            : "No shops are available on this page."}{" "}
          <Link href={href({ view: "shops" })}>Browse shops</Link>
        </p>
      )}
      {!preview && (
        <Pagination
          page={page}
          totalPages={state.data.totalPages}
          params={params}
        />
      )}
      {preview && state.data.total > 3 && (
        <Link className="text-link" href={href({ view: "shops" })}>
          See all shops →
        </Link>
      )}
    </>
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
                </Link>
              ) : (
                <Photo src={p.image} />
              )}
            </div>
            <div className="product-info">
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
              <span className="product-shop">
                {p.shopName ?? context.shop}
                {p.outletName ? ` · ${p.outletName}` : ""}
              </span>
              <small>{p.productType}</small>
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
function Products({
  params,
  coordinates,
}: {
  params: Params;
  coordinates: Coordinates | null;
}) {
  const { selected } = useCustomer();
  const router = useRouter();
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
    query.set("vendorId", params.vendorId || "");
    query.set("locationGid", params.locationGid || "");
  }
  const state = useData<ProductPage>(`/api/catalogue/browse?${query}`);
  return (
    <section className="catalogue">
      {!search && params.outletId && (
        <DeliveryStatus vendorId={params.vendorId} outletId={params.outletId} />
      )}
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
      {!search && (
        <form
          className="search-form collection-search"
          onSubmit={(event) => {
            event.preventDefault();
            const next: Params = {
              ...params,
              query: String(
                new FormData(event.currentTarget).get("query") || "",
              ).trim(),
            };
            delete next.page;
            router.push(href(next));
          }}
          action="/"
          role="search"
        >
          {Object.entries(params)
            .filter(([k]) => !["query", "page"].includes(k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <label className="sr-only" htmlFor="collection-query">
            Search this shop
          </label>
          <input
            id="collection-query"
            name="query"
            maxLength={120}
            defaultValue={params.query}
            placeholder="Search this shop"
          />
          <button type="submit">Search</button>
        </form>
      )}
      {!state.data ? (
        <LoadMessage {...state} />
      ) : state.data.requiresLocation ? (
        <p className="catalogue-message">
          Choose a saved address or use your current location in the location
          menu above to find products nearby, or{" "}
          <Link href={href({ view: "shops" })}>
            browse shops without sharing your location
          </Link>
          .
        </p>
      ) : state.data.outOfDeliveryArea ? (
        <p className="catalogue-message">
          No participating shop locations were found near this location. You can
          still <Link href={href({ view: "shops" })}>browse the shops</Link>.
        </p>
      ) : (
        <>
          <div className="results-bar">
            <span>{state.data.total} products</span>
            <Link href="/saved">Your saved finds →</Link>
          </div>
          <ProductGrid products={state.data.products} context={params} />
          {!state.data.products.length && (
            <p className="catalogue-message">
              No products found. Try a different search or another shop.
            </p>
          )}
          <Pagination
            page={state.data.page}
            totalPages={state.data.totalPages}
            params={params}
          />
        </>
      )}
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
      <Product params={params} overlay />
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
            {images.map((src, i) => (
              <button
                key={src + i}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={index === i}
                onClick={() => select(i)}
              >
                <Photo src={src} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function Product({
  params,
  overlay = false,
}: {
  params: Params;
  overlay?: boolean;
}) {
  const query = new URLSearchParams({
    kind: "product",
    vendorId: params.vendorId || "",
    productId: params.productId || "",
    locationGid: params.locationGid || "",
  });
  const state = useData<ProductDetail>(`/api/catalogue/browse?${query}`);
  const [variantId, selectVariant] = useState("");
  const product = state.data;
  const selected = product?.variants.find((v) => v.id === variantId);
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
            <p>{[params.shop, params.branch].filter(Boolean).join(" · ")}</p>
            {overlay ? <h2>{product.title}</h2> : <h1>{product.title}</h1>}
            <FavouriteButton
              target={{
                kind: "product",
                vendorId: params.vendorId,
                productId: product.id,
              }}
            />
            <p className="detail-price">
              {selected
                ? money(selected.price)
                : product.variants.some((v) => v.price !== null)
                  ? `From ${money(Math.min(...product.variants.map((v) => v.price ?? Infinity)))}`
                  : "Price unavailable"}
            </p>
            <fieldset>
              <legend>Choose a variant to see its availability</legend>
              <div className="sizes">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    aria-pressed={variantId === v.id}
                    className={variantId === v.id ? "selected" : ""}
                    onClick={() => selectVariant(v.id)}
                  >
                    {v.title}
                    {variantId === v.id ? " ✓" : ""}
                    {v.inventory === 0 ? " · Out of stock" : ""}
                  </button>
                ))}
              </div>
            </fieldset>
            <p role="status" className="stock-status">
              {selected
                ? selected.inventory === null
                  ? "Availability unavailable"
                  : selected.inventory > 0
                    ? `${selected.inventory} available at this shop location`
                    : "Out of stock at this shop location"
                : "Select a variant above."}
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
            <Link className="text-link product-shop-link" href={href(back)}>
              See more from this shop →
            </Link>
            {params.outletId && (
              <DeliveryStatus
                vendorId={params.vendorId}
                outletId={params.outletId}
              />
            )}
            <p>
              Browsing is available in this staging version. No order or payment
              can be created here.
            </p>
            <Link className="text-link" href="/saved">
              View your saved finds →
            </Link>
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
            <button
              className="video-control"
              aria-controls="hero-video"
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? "Play" : "Pause"} video
            </button>
          </>
        )}
      </div>
    </section>
  );
}
function AreaCards() {
  return (
    <div className="area-grid">
      {areas.map((a, i) => (
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
            <span aria-hidden="true">→</span>
          </div>
        </Link>
      ))}
    </div>
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
          <h1>
            {area.headline.map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h1>
          <p>{area.intro}</p>
          <Link className="primary" href={href({ view: "shops" })}>
            Browse STREET shops →
          </Link>
          <p>
            Explore the neighbourhood for inspiration. This guide does not set
            your delivery or search location.
          </p>
        </div>
      </section>
      <section className="section">
        <h2>Keep wandering.</h2>
        <AreaCards />
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
              <div className="section-heading">
                <h2>Every street has a story.</h2>
              </div>
              <AreaCards />
            </section>
          </>
        )}
        {view === "shops" && (
          <section className="catalogue">
            <div className="catalogue-intro">
              <h1>Step inside.</h1>
              <p>
                Explore the shops on STREET. Choose a location to browse its
                products.
              </p>
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
            <h1>
              Where shall
              <br />
              we wander?
            </h1>
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
      <footer className="frame footer">
        <span className="footer-brand">STREET</span>
        <div>
          Your high street. Delivered.
          <small>
            Staging catalogue. No orders or payments.
            <br />
            Neighbourhood photography and hero video are editorial
            illustrations.
          </small>
        </div>
        <Link className="text-link" href="/account">
          Your profile →
        </Link>
      </footer>
    </>
  );
}

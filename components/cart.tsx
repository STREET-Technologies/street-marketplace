"use client";
import Checkout from "./checkout";
import { sameSubmittedBag, type SavedCheckout } from "../lib/checkout";
import { variantOptionLabels } from "../lib/product-options";
import NavigationIcon from "./navigation-icon";
import { productOptionPrompt } from "../lib/product-presentation";
import { CustomerEmptyState, CustomerSignIn } from "./customer-page";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
  CartDraft,
  CartLine,
  CartReview,
  ProductDetail,
} from "../lib/contracts";
import {
  addCartLine,
  restoreCart,
  cartStorageKey,
  cartLineKey,
  cartIntent,
  CART_MAX_QUANTITY,
} from "../lib/cart";
import { postAccountData } from "../lib/client/session";
import { useCustomer } from "./customer-context";
const money = (value: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    value,
  );
type CartContextValue = {
  cart: CartDraft | null;
  ready: boolean;
  notice: string;
  add: (
    outlet: Omit<CartDraft, "lines">,
    line: CartLine,
    inventory: number,
    replace?: boolean,
  ) => boolean;
  quantity: (line: CartLine, quantity: number) => void;
  remove: (line: CartLine) => void;
  completeCheckout: (saved: SavedCheckout) => void;
};
const CartContext = createContext<CartContextValue | null>(null);
function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("Cart provider missing");
  return context;
}
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { state } = useCustomer();
  const owner =
    state.status === "ready"
      ? state.data!.userId
      : state.status === "guest"
        ? null
        : undefined;
  const [stored, setStored] = useState<{
    owner: string | null;
    cart: CartDraft | null;
  }>({ owner: null, cart: null });
  const [notice, setNotice] = useState("");
  const current = useRef(stored);
  useEffect(() => {
    if (owner === undefined) return;
    const load = () => {
      let cart: CartDraft | null = null;
      try {
        if (owner)
          cart = restoreCart(localStorage.getItem(cartStorageKey(owner)));
        setNotice("");
      } catch {
        setNotice(
          "This browser cannot save your bag. It will only be kept until you leave this page.",
        );
      }
      const next = { owner, cart };
      current.current = next;
      setStored(next);
    };
    if (current.current.owner !== owner) load();
    const storage = (event: StorageEvent) => {
      if (owner && (event.key === cartStorageKey(owner) || event.key === null))
        load();
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, [owner]);
  const ready =
    Boolean(owner) && stored.owner === owner && state.status === "ready";
  function commit(cart: CartDraft | null) {
    if (!owner || !ready || current.current.owner !== owner)
      throw new Error("Sign in before changing your bag.");
    const next = { owner, cart };
    current.current = next;
    setStored(next);
    try {
      if (cart?.lines.length)
        localStorage.setItem(cartStorageKey(owner), JSON.stringify(cart));
      else localStorage.removeItem(cartStorageKey(owner));
      setNotice("");
    } catch {
      setNotice(
        "Changes are kept on this page, but this browser could not save them for your next visit.",
      );
    }
  }
  const add: CartContextValue["add"] = (
    outlet,
    line,
    inventory,
    replace = false,
  ) => {
    const result = addCartLine(
      current.current.cart,
      outlet,
      line,
      inventory,
      replace,
    );
    if (result.conflict) return false;
    commit(result.cart);
    return true;
  };
  const quantity: CartContextValue["quantity"] = (line, quantity) => {
    const cart = current.current.cart;
    if (!cart) return;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > CART_MAX_QUANTITY
    )
      return;
    commit({
      ...cart,
      lines: cart.lines.map((l) =>
        cartLineKey(l) === cartLineKey(line) ? { ...l, quantity } : l,
      ),
    });
  };
  const remove: CartContextValue["remove"] = (line) => {
    const cart = current.current.cart;
    if (!cart) return;
    const lines = cart.lines.filter(
      (l) => cartLineKey(l) !== cartLineKey(line),
    );
    commit(lines.length ? { ...cart, lines } : null);
  };
  return (
    <CartContext.Provider
      value={{
        cart: ready ? stored.cart : null,
        ready,
        notice,
        add,
        quantity,
        remove,
        completeCheckout: (saved) => {
          if (saved.owner !== owner || !sameSubmittedBag(current.current.cart, saved)) return;
          // Another tab may have edited the bag while checkout was open.
          try {
            const disk = restoreCart(localStorage.getItem(cartStorageKey(owner!)));
            if (!sameSubmittedBag(disk, saved)) return;
          } catch { return; }
          commit(null);
        },
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
export function BagLink({ active = false }: { active?: boolean }) {
  const { cart } = useCart();
  const count = cart?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  return (
    <Link
      href="/bag"
      className="header-action"
      aria-label={`Bag, ${count} items`}
      title="Bag"
      aria-current={active ? "page" : undefined}
    >
      <NavigationIcon name="bag" filled={active} />
      {count > 0 && (
        <span className="bag-count" aria-hidden="true">
          {count}
        </span>
      )}
    </Link>
  );
}
export function AddToBag({
  outlet,
  product,
  variant,
}: {
  outlet: Omit<CartDraft, "lines">;
  product: ProductDetail;
  variant: ProductDetail["variants"][number] | undefined;
}) {
  const { state } = useCustomer();
  const { cart, ready, add } = useCart();
  const [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirm && state.status === "ready") dialog.current?.showModal();
    else dialog.current?.close();
    return () => dialog.current?.close();
  }, [confirm, state.status]);
  const unavailable =
    !variant ||
    variant.inventory === null ||
    variant.inventory < 1 ||
    variant.price === null;
  function submit(replace = false) {
    if (!variant || variant.inventory === null || variant.price === null)
      return;
    try {
      const added = add(
        outlet,
        {
          productId: product.id,
          variantId: variant.id,
          title: product.title,
          variantTitle: variant.title,
          optionLabels: variantOptionLabels(product, variant.id),
          image: product.images[0] ?? null,
          unitPrice: variant.price,
          quantity: 1,
        },
        variant.inventory,
        replace,
      );
      if (!added) {
        setConfirm(true);
        return;
      }
      setConfirm(false);
      setMessage(
        "Added to your bag. Review it to check current stock and prices.",
      );
    } catch (error) {
      setConfirm(false);
      setMessage(
        error instanceof Error ? error.message : "Unable to update your bag.",
      );
    }
  }
  if (state.status === "guest")
    return (
      <Link className="primary primary--lime wide" href="/account">
        Sign in to add to bag
      </Link>
    );
  return (
    <div className="add-to-bag">
      <button
        className="primary wide"
        disabled={!ready || unavailable || !outlet.outletId}
        onClick={() => submit()}
      >
        {!variant
          ? productOptionPrompt(
              product.options
                ?.filter((o) => o.values.length > 1)
                .map((o) => o.name),
            )
          : unavailable
            ? "Currently unavailable"
            : "Add to bag"}
      </button>
      {message && (
        <p role="status">
          {message}{" "}
          <Link className="text-link" href="/bag">
            View bag →
          </Link>
        </p>
      )}
      <dialog
        ref={dialog}
        onCancel={() => setConfirm(false)}
        aria-labelledby="replace-bag-title"
      >
        <div className="simple-modal">
          <h2 id="replace-bag-title">Start a bag for this shop?</h2>
          <p>
            Your bag contains items from {cart?.shopName}
            {cart?.branch ? ` · ${cart.branch}` : ""}. A bag can only contain
            items from one shop location.
          </p>
          <p>
            Replace it with {outlet.shopName}
            {outlet.branch ? ` · ${outlet.branch}` : ""}?
          </p>
          <div className="cart-actions">
            <button className="secondary" onClick={() => setConfirm(false)}>
              Keep my bag
            </button>
            <button className="primary" onClick={() => submit(true)}>
              Replace bag
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
export default function Bag({ checkoutEnabled = false }: { checkoutEnabled?: boolean }) {
  const { state, selected } = useCustomer();
  const { cart, ready, notice, quantity, remove, completeCheckout } = useCart();
  const [revision, recheck] = useState(0);
  const [review, setReview] = useState<{
    key: string;
    data?: CartReview;
    error?: string;
  }>({ key: "" });
  const userId = state.status === "ready" ? state.data!.userId : "";
  const payload =
    cart && selected ? JSON.stringify(cartIntent(cart, selected.id)) : "";
  const fingerprint = userId + ":" + payload;
  useEffect(() => {
    if (!ready || !payload) return;
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setReview({ key: fingerprint });
    postAccountData<CartReview>("/api/cart/check", JSON.parse(payload))
      .then((data) => {
        if (data.userId !== userId)
          throw new Error("Your account changed. Reload your bag.");
        if (active) {
          setReview({ key: fingerprint, data });
          expiry = setTimeout(() => {
            if (active) recheck((value) => value + 1);
          }, 60000);
        }
      })
      .catch((error) => {
        if (active)
          setReview({
            key: fingerprint,
            error:
              error instanceof Error
                ? error.message
                : "Your bag could not be checked.",
          });
      });
    return () => {
      active = false;
      clearTimeout(expiry);
    };
  }, [fingerprint, payload, userId, ready, revision]);
  const result = payload && review.key === fingerprint ? review : undefined;
  const data = result?.data;
  const checkout = <Checkout owner={userId} cart={cart} addressId={selected?.id} enabled={checkoutEnabled} complete={completeCheckout}
    eligible={!!data && data.total !== null && data.delivery.status === "available" && data.delivery.isOpen === true && data.lines.every(line => line.issue === null)} />;
  if (state.status === "guest")
    return (
      <CustomerSignIn
        icon="bag"
        title="Your bag is empty"
        message="Sign in to add items to your bag."
      />
    );
  if (state.status === "error")
    return (
      <section className="customer-panel">
        <p role="alert">
          Your account could not be loaded. Reload the page to try again.
        </p>
      </section>
    );
  if (!ready) return <p role="status">Loading your bag…</p>;
  if (!cart?.lines.length)
    return (
      <CustomerEmptyState
        icon="bag"
        title="Your bag is empty"
        message="Browse the stores near you and add something you love."
      >
        <Link className="primary" href="/?view=shops">
          Start Shopping
        </Link>
        {checkoutEnabled && checkout}
      </CustomerEmptyState>
    );
  const count = cart.lines.reduce((total, line) => total + line.quantity, 0);
  const shopUrl = `/?${new URLSearchParams({ view: "shops", vendorId: cart.vendorId, outletId: cart.outletId })}`;
  return (
    <section className="cart-page">
      {notice && <p role="alert">{notice}</p>}
      <div className="cart-layout">
        <div className="cart-items">
          <header className="cart-shop">
            <div>
              <h2>{cart.shopName}</h2>
              <p>
                {cart.branch} · {count} {count === 1 ? "item" : "items"}
              </p>
            </div>
            <Link className="text-link" href={shopUrl}>
              Continue shopping
            </Link>
          </header>
          <p className="cart-shop-note">
            Shopping from <strong>{cart.shopName}</strong>. Adding items from another store will clear your current cart.
          </p>
          <div className="cart-lines">
            {cart.lines.map((line) => {
              const checked = data?.lines.find(
                (l) => cartLineKey(l) === cartLineKey(line),
              );
              const confirmed =
                checked?.unitPrice !== null && checked?.unitPrice !== undefined;
              const price = checked?.unitPrice ?? line.unitPrice;
              const increase =
                checked?.issue === null &&
                checked.inventory !== null &&
                checked.inventory !== undefined &&
                line.quantity < checked.inventory &&
                line.quantity < CART_MAX_QUANTITY;
              return (
                <article className="cart-line" key={cartLineKey(line)}>
                  {(checked?.image ?? line.image) ? (
                    <img src={(checked?.image ?? line.image)!} alt="" />
                  ) : (
                    <div className="image-unavailable">Image unavailable</div>
                  )}
                  <div className="cart-line-detail">
                    <h3>{checked?.title ?? line.title}</h3>
                    <p className="cart-variant">
                      {(checked?.optionLabels ?? line.optionLabels ?? [{ name: "Option", value: checked?.variantTitle ?? line.variantTitle }])
                        .filter((option) => option.value !== "Default Title")
                        .map((option) => `${option.name}: ${option.value}`).join(" · ")}
                    </p>
                    <p className="cart-unit-price">
                      {money(price)} each
                      {!confirmed && " · Price not confirmed"}
                    </p>
                    {confirmed && price !== line.unitPrice && (
                      <p className="cart-line-notice">
                        Price changed from {money(line.unitPrice)} to{" "}
                        {money(price)}.
                      </p>
                    )}
                    {checked?.issue === "stock" && (
                      <p className="cart-line-notice" role="status">
                        {checked.inventory === 0
                          ? "Out of stock. Remove this item."
                          : `Only ${checked.inventory} available. Reduce the quantity.`}
                      </p>
                    )}
                    {checked?.issue === "unavailable" && (
                      <p className="cart-line-notice" role="status">
                        This variant is no longer available from this shop.
                        Remove it to update your bag.
                      </p>
                    )}
                    {checked?.issue === "unknown" && (
                      <p className="cart-line-notice" role="status">
                        Availability has not been confirmed for this item.
                      </p>
                    )}
                    <div className="cart-line-controls">
                      <div
                        className="cart-quantity"
                        role="group"
                        aria-label={`Quantity for ${line.title}`}
                      >
                        <button
                          disabled={line.quantity <= 1}
                          onClick={() => quantity(line, line.quantity - 1)}
                          aria-label={`Decrease quantity of ${line.title} ${line.variantTitle}`}
                        >
                          −
                        </button>
                        <span
                          aria-live="polite"
                          aria-label={`Quantity ${line.quantity}`}
                        >
                          {line.quantity}
                        </span>
                        <button
                          disabled={!increase}
                          onClick={() => quantity(line, line.quantity + 1)}
                          aria-label={`Increase quantity of ${line.title} ${line.variantTitle}`}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-link cart-remove"
                        onClick={() => remove(line)}
                        aria-label={`Remove ${line.title} ${line.variantTitle}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <strong className="cart-line-total">
                    {money((Math.round(price * 100) * line.quantity) / 100)}
                    {!confirmed && <small>When added</small>}
                  </strong>
                </article>
              );
            })}
          </div>
          <p className="cart-browser-note">
            This bag is saved on this browser. It doesn’t sync with your app’s
            bag yet.
          </p>
        </div>
        <aside className="cart-summary" aria-labelledby="bag-summary-title">
          <div className="cart-address">
            <NavigationIcon name="location" />
            <div>
              <h2>Delivery address</h2>
              {selected ? (
                <p>
                  {[
                    selected.line1,
                    selected.line2,
                    selected.city,
                    selected.postcode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : (
                <p>
                  Choose a saved address to check stock, prices and delivery
                  availability.
                </p>
              )}
              <button
                className="text-link"
                aria-haspopup="dialog"
                aria-controls="location-picker"
                onClick={() =>
                  document.getElementById("location-trigger")?.click()
                }
              >
                {selected ? "Change address" : "Choose address"}
              </button>
            </div>
          </div>
          <h2 id="bag-summary-title">Order summary</h2>
          <dl className="cart-totals">
            <div>
              <dt>
                Subtotal{" "}
                <span>
                  ({count} {count === 1 ? "item" : "items"})
                </span>
              </dt>
              <dd>
                {data?.subtotal !== null && data?.subtotal !== undefined
                  ? money(data.subtotal)
                  : "Not confirmed"}
              </dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>
                {data?.deliveryFee != null
                  ? money(data.deliveryFee)
                  : selected
                    ? "Not confirmed"
                    : "Choose an address"}
              </dd>
            </div>
            <div className="cart-grand-total">
              <dt>Total</dt>
              <dd>
                {data?.total != null ? money(data.total) : "Not confirmed"}
              </dd>
            </div>
          </dl>
          <div className="cart-check-status" aria-live="polite">
            {selected && !result?.data && !result?.error && (
              <p role="status">Checking stock and prices…</p>
            )}
            {result?.error && (
              <p role="alert">
                {result.error} Prices and availability have not been confirmed.
              </p>
            )}
            {data && (
              <>
                {data.deliveryFee !== null && (
                  <p>
                    Delivery {money(data.deliveryFee)} is not refunded once your order is on its way. Returns and refunds are handled by {cart.shopName}.
                  </p>
                )}
                {data.delivery.status !== "available" && (
                  <p>{data.delivery.status === "unavailable"
                    ? "This shop does not currently serve your address. Choose another address or shop."
                    : "Delivery availability could not be confirmed."}</p>
                )}
                {data.delivery.status === "available" && data.delivery.isOpen === false && (
                  <p>This shop is currently closed.</p>
                )}
                {data.delivery.status === "available" &&
                  data.deliveryFee === null && (
                    <p>
                      Delivery fee couldn’t be loaded. Please try again.
                    </p>
                  )}
                {data.subtotal === null && (
                  <p>Review the items in your bag to confirm your subtotal.</p>
                )}
              </>
            )}
          </div>
          {checkout}
          {(result?.error || data?.delivery.status === "unknown" ||
            (data?.delivery.status === "available" && (data.deliveryFee === null || data.lines.some((line) => line.issue === "unknown")))) && (
            <button className="text-link cart-recheck" onClick={() => recheck((v) => v + 1)}>
              Try again
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

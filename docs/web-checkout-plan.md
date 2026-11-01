# Shared staging checkout — TT-534

Updated: 2026-11-01. Backend v5.50.3 deployed to staging; local website checkout enabled. Vercel rollout remains pending.

## Scope and current state

The user approved a shared backend checkout boundary for web and app. The backend implementation is isolated in `.worktrees/tt534-backend` on `feat/tt-534-shared-checkout`, based on deployed v5.49.2, preserving unrelated commission work in the original backend checkout. Web is on `feat/tt-534-web-checkout`. Mobile adoption is disabled by default and preserves the legacy flow outside the staging pilot.

Local user testing created one pending STREET order and its Shopify cart. No completed Shopify order/payment was observed during the checkout handoff investigation. Staging schema was inspected read-only before writing the additive migration. Its existing `orders.outletId` is reused.

## Pilot target

- STREET API: `https://staging-api.street.london/v1`.
- Gymshark vendor: `e13ad453-943c-4861-891a-feae35a805d4`.
- Regent Street outlet: `0eb52280-293f-480e-ad39-ffa76970c1e1`.
- Shopify location: `gid://shopify/Location/81968234566`.
- Store: `gymshark-10024.myshopify.com`.
- Shared Storefront API version: `2026-04`.

Shopify admin verified the active test payment gateway, automatic capture at checkout, and the General shipping profile covering Regent Street with Same-Day Delivery at £9.99. Actual cart handoff and payment remain acceptance tests.

## Shared contract

Authenticated `POST /checkout-attempts` accepts an attempt UUID, vendor UUID, outlet UUID, owned address UUID and product/variant IDs with quantities. It rejects client prices, totals, customer IDs and arbitrary checkout URLs. `GET /checkout-attempts/:id` returns ownership-scoped attempt state and a validated checkout URL when ready.

Canonical validation checks saved address ownership, delivery area, opening hours, selected outlet catalogue, stock, prices and buyer contact details. A transaction with a per-customer PostgreSQL advisory lock commits the pending STREET order, items and attempt together. Unique indexes enforce attempt-key replay and one active checkout per customer. Shopify calls happen after commit.

The cart is checkpointed server-side with AES-256-GCM encryption. Tokens are loaded from the existing vendor integration rather than stored in attempt snapshots. Ambiguous external responses retain the original attempt; they never trigger a replacement order/cart. Definite pre-transaction business validation errors return `CHECKOUT_NOT_STARTED`, allowing the client to explicitly discard only an intent that did not start.

Storefront Cart API creates the cart, preserves the existing mobile STREET order/outlet/location/address attributes, validates line quantities and GBP subtotal, and selects the unique `Same-Day Delivery` rate matching the platform fee. GraphQL operations were validated with Shopify Dev MCP against `2026-04`. Runtime queries live in the backend helper, not this document.

Web uses Shopify-hosted checkout in the same tab. Mobile presents the same URL in the existing native Checkout Sheet. Neither a browser return nor a Sheet cancellation cancels the STREET order. Canonical backend status alone confirms completion. Authorization awaiting retailer acceptance is not described as payment capture. Bag clearing requires a matching submitted snapshot; later edits survive.

## Enablement

Backend requires `NODE_ENV=staging`, `STAGING_CHECKOUT_ENABLED=true`, `STAGING_CHECKOUT_VENDOR_ID`, `STAGING_CHECKOUT_OUTLET_ID` and a base64-encoded 32-byte `CHECKOUT_ENCRYPTION_KEY`. Migration: `1780000320000-CreateCheckoutAttempts`. Keep the encryption key stable across deployments so existing attempts remain recoverable.

Web requires server-only `CHECKOUT_ENABLED=true`; the pilot vendor/outlet and HTTPS destination remain explicitly restricted. Mobile requires its disabled-by-default shared checkout compile flag, exact staging API and pilot retailer. No production rollout is included.

## Verification completed

- Backend orders/checkout regression suite: 24 suites, 201 tests passed; backend build passed.
- Real isolated PostgreSQL: five integration tests passed for concurrent same-key replay, different-key contention, transaction rollback, encrypted recovery/ownership and the partial unique index.
- Web: 87 tests, TypeScript and Next build passed.
- Mocked browser checks: disabled gate, persistence before initiation, identical retry after lost response, hosted handoff, uncertain return, exact-snapshot clearing, preserved newer edits, owned conflict recovery, definite-preflight reset, account isolation and mobile layout.
- Mobile: 19 focused tests passed (11 shared checkout and eight existing outlet-lock tests); device Checkout Sheet acceptance remains outstanding. Compile flag: `--dart-define=ENABLE_SHARED_CHECKOUT=true`. Cold sessions may need the selected shop reopened to resolve its exact outlet UUID; no primary-outlet fallback is used.

PostgreSQL test command (isolated local `checkout_test` database only):

```sh
TEST_CHECKOUT_DATABASE_URL=postgresql://postgres:checkout_test_only@127.0.0.1:55434/checkout_test npm test -- --config test/jest-checkout-postgres.json --runInBand
```

## Remaining staging acceptance and limitations

1. Backend deployment completed via deploy.sh: v5.50.0, commit 1ad4aec, migration CreateCheckoutAttempts1780000320000, PM2 online with version match and clean new boot. Staging-only pilot flags and encryption key configured; secure previous env backup retained on server. Rollback target v5.49.2 is compatible with the additive table. Local localhost:4319 is enabled; Vercel and mobile rollout remain pending.
2. Gymshark test gateway, automatic capture and configured £9.99 delivery rate are confirmed read-only in Shopify admin; verify the same rate is returned for the actual checkout address. Existing Shopify shipping provisioning does not update a pre-existing rate merely because its name matches.
3. Test success, decline, abandonment/back/resume, stale stock, delivery mismatch and delayed authorization/webhooks. Confirm customer, items, selected outlet, STREET order and Shopify order agree; verify retailer/courier side effects occur only at the appropriate existing lifecycle steps.
4. A process crash during cart creation can leave a `preparing` attempt requiring support recovery. Automatic takeover is deliberately absent because a delayed worker or lost response can still have created a Shopify cart. One active attempt also prevents silently replacing an abandoned checkout; an explicit safe cancellation/recovery workflow is future work.
5. Hosted checkout can permit edits to delivery details, discounts or rates after handoff. This pilot validates before handoff; it does not claim to lock Shopify checkout or replace existing webhook reconciliation. Any Shopify Function changes need separate review.
6. Cross-device bag sync remains a separate ticket. Sharing the checkout boundary does not introduce bag synchronization.

## Shopify references

- [Manage carts](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Cart API migration](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/migrate-to-cart-api)
- [Cart reference, 2026-04](https://shopify.dev/docs/api/storefront/2026-04/queries/cart)


## Local checkout handoff fix — 2026-11-01

The first live cart exposed a runtime Shopify constraint absent from schema validation: deliveryGroups(withCarrierRates: true) requires @defer and multipart response handling. STREET uses a static flat shipping rate, so the synchronous query now omits that argument. A read-only replay against the existing cart returned its £36 subtotal and £9.99 rate correctly. Regression reproduces the original Shopify rejection and passes after correction; 51 backend checkout tests and build passed. Patch release v5.50.1 contains no migration.

Shopify also returned a valid hosted checkout URL using /cart/c/, whereas the web adapter originally accepted only /checkouts/. The fixed web adapter permits both on the exact allowlisted HTTPS store host; other paths/hosts remain rejected. Web89 tests/typecheck passed. Local status text now distinguishes a ready checkout from one that could not yet be opened.


## Canonical order numbering correction — 2026-11-01

The initial web override generated ST-W UUID references, contrary to the mobile/backend contract. v5.50.2 removes that override and uses the same existing backend maximum numeric order plus one, padded to six digits (ST-00xxxx). OrdersService owns the single formatting helper for pending orders and Shopify ingestion. The checkout attempt retains an internal UUID, separate from the public order number. Regression tests verify no override is supplied and the canonical number reaches both attempt snapshot and Shopify cart input; 206 order/checkout tests and build passed.

Historical test order ST-WB40CA1F5BAE447D9BF2DE0927C259C61 is already linked to Shopify7098667597894 and recorded as PAID/MISSED. It was not renamed independently because Shopify and downstream references must remain consistent. New checkout creation uses the restored sequence.


## Bag reconciliation after order placement — 2026-11-01

Checkout completion is distinct from the later order lifecycle. The first paid order reached MISSED before the browser reconciled, and the old API projected cancelled, retaining its bag. v5.50.3 projects completed for retailer MISSED/REJECTED outcomes and linked captured payment/refund evidence; a linked authorization subsequently voided also counts as placement. Already-completed attempts never regress on later cancellation. Unpaid abandonment remains cancelled. The canonical order status is unchanged.

The browser can now clear the exact submitted bag after return even when the retailer outcome already changed. Later local bag edits remain protected. Tests cover recovery of old misclassified attempts, authorized-but-not-captured missed orders, refunded/cancelled orders and unpaid abandonment: 214 backend order/checkout tests passed, plus 90 web tests/typecheck.

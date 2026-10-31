# STREET marketplace staging integration

Status: Local staging marketplace has shared OTP/session, real catalogue/search, saved-address selection, service-area checks, shared favourite editing and a one-outlet local cart (TT-504, TT-507–510). User confirmed existing-account login and catalogue/favourites display. Checkout remains disabled; not deployed.

## Requirements

- Reuse the approved hybrid PoC design and editorial assets, refining the design against real staging content.
- Use the existing STREET backend, retailer integrations, customer records, product/variant identifiers, orders and delivery pipeline. No marketplace account database, separate catalogue sync, or replacement payment provider.
- A customer who signs in on the website must access the same account in the staging mobile app. Canonical identity is `GET /auth/me` → `user.id`.
- All STREET requests target `https://staging-api.street.london/v1`. No production fallback. Shopify stores, payment test mode and courier environment must also be verified before purchase testing.
- Use Shopify hosted checkout on web and the existing Shopify webhook → STREET backend reconciliation pipeline.
- Keep the original `street-desktop-poc` untouched. This folder was copied from tracked commit `d6607ef8b005ce7cafcd62d7d6004876df550ec2`; Git metadata, build output and untracked video-upload files were excluded.

## Approved foundation

Use Next.js/TypeScript for the marketplace, retaining the visual design and assets. This matches the framework already used by the marketing site and vendor portal. A thin server layer handles browser sessions and typed requests to the existing backend; it owns no business records and does not duplicate pricing, identity, stock or fulfilment logic.

Keep STREET access/refresh tokens in host-only HttpOnly cookies on the marketplace. Forward credentials server-side to the existing auth APIs, support refresh and backend logout, protect mutation endpoints against cross-site requests, and never use a global mutable customer session. Use explicit endpoint adapters rather than an unrestricted proxy. Private customer responses must not enter shared caches. Pin the upstream to staging and reject arbitrary upstream URLs. The foundation now implements this browser session/API boundary; connected shopping and authenticated customer-data flows follow in subsequent slices.

This avoids relying on cross-site API cookies from a Vercel preview. The current backend allows localhost origins, but not a marketplace staging hostname or general marketplace Vercel previews. A direct-browser API implementation would instead need explicit CORS configuration and a compatible cookie/session policy.

Next.js supports this thin server pattern through Route Handlers and server cookie APIs: https://nextjs.org/docs/app/guides/backend-for-frontend and https://nextjs.org/docs/app/api-reference/functions/cookies. It runs with a server runtime; `vercel.json` now selects Next.js rather than static output.

## Existing integration contracts

Paths are relative to the parent STREET workspace. These are local-source findings, not a claim that every deployed contract has been exercised.

| Capability | Existing contract | Evidence |
| --- | --- | --- |
| Phone signup/login | `POST /auth/request-otp {phone}`, `POST /auth/verify-otp {phone,code}`, then `GET /auth/me`; backend finds/creates by normalized E.164 phone | `street-client-app/lib/app/features/auth/data/source/auth_data_source_real_impl.dart:45`; `street-backend/src/modules/v1/users/services/users.service.ts:56` |
| Session lifecycle | `POST /auth/refresh` accepts refresh token; `POST /auth/logout` revokes that session. Separate session families permit concurrent mobile/web sessions | `street-backend/src/modules/v1/auth/controllers/auth.controller.ts:230`; `services/auth.service.ts:86` |
| Profile | `PATCH /users/:id` updates existing canonical user. No web-specific user creation | `street-backend/src/modules/v1/users/users.controller.ts:30` |
| Shops/outlets | `GET /vendors` with coordinates, pagination/category/name; preserve vendor UUID, outlet UUID and Shopify location GID separately | `street-client-app/lib/app/features/home/data/source/store_api_data_source.dart:128`; `street-backend/src/modules/v1/vendors/vendors.service.ts:1259` |
| Catalogue | `/vendors/:vendorId/products` and `/:productId`, passing `locationGid`; lists support `productType` and `includeFacets=true` | `street-backend/src/modules/v1/vendors/vendors.controller.ts:656` |
| Global search | `GET /search` with query/coordinates; `requiresLocation:true` is an address-selection state, not an empty search | `street-backend/src/modules/v1/search/search.controller.ts:7` |
| Shared configuration | `GET /config/app-settings`, `/config/vendor-categories`; do not hardcode platform fees/categories | `street-backend/src/modules/v1/platform-config/platform-config.controller.ts:6` |
| Saved shops/products | `/favorites/vendors` is outlet-specific; `/favorites/products` uses vendorId + productShopifyId | `street-client-app/lib/app/features/home/data/source/favorite_api_data_source.dart:30` |
| Saved addresses | `/user-addresses` CRUD and `/validate`; retain coordinates and delivery instructions | `street-client-app/lib/app/features/addresses/data/models/user_address_model.dart:118` |
| Availability | `/vendors/:vendorId/online-status?outletId=...` | `street-client-app/lib/app/features/home/data/source/store_api_data_source.dart:120` |
| Bag | Mobile stores cart locally in user-scoped Hive; enforce one outlet, including different branches of the same vendor | `street-client-app/lib/app/di/injections.dart:277`; `features/cart/presentation/bloc/cart_bloc.dart:286` |
| Orders | `GET /orders/my`, `/orders/:id`, `/orders/:id/pricing`; authenticated ownership checks remain in backend | `street-client-app/lib/app/features/orders/data/source/order_api_data_source.dart:99` |
| Tracking | Backend JWT → `/auth/firebase-token` → Firebase custom auth → RTDB `orders/{order UUID}`. Delivery PIN stays in authenticated REST | `street-client-app/lib/app/core/services/firebase_auth_service.dart:80`; `lib/core/services/firebase_realtime_service.dart:203` |

Response envelopes vary: vendor/product lists use `data.data` plus metadata. Build explicit adapters and fixture tests; do not infer API shapes from unused mobile endpoint constants. Render API content as text; do not inject untrusted HTML. Explicitly project browser-facing fields.

## Shared-account acceptance and caveats

The backend already supports one account accessed from both devices using the same login identifier. Start with phone OTP, the existing create-or-find flow. General consumer email/password signup does not exist in the audited auth implementation; password login is restricted to test accounts.

Google uses verified email lookup, whereas OTP uses phone lookup. Identifiers must already coexist on the same user to auto-link. A phone-only account followed by Google sign-in before email association can produce two records. Do not promise universal cross-provider deduplication from UI reuse alone. A verified linking/recovery design is a separate backend decision; do not silently merge existing users. Apple web enablement is blocked on TT-505.

Acceptance: create a dedicated test customer through web OTP, record `/auth/me.id`, sign into the staging mobile app using the same number, and assert identical user ID, profile, saved addresses and favourites. Repeat mobile-first → web. Verify refresh, expired session recovery and that logout from one device does not invalidate the other device's independent session. Do not use or alter unrelated staging users for these checks.

Cart persistence is currently device-local in the mobile implementation. Shared accounts do not imply a synchronized cart. Initial web parity is user-scoped local cart persistence; cross-device cart sync would be new shared backend functionality requiring an explicit decision.

## Checkout: reuse and browser-specific work

The existing backend creates the pending STREET order; the Flutter app currently creates the Shopify cart. There is no existing consumer cartCreate/browser-return service in the searched backend or Shopify-app source. The marketplace server layer can own its web handoff, keeping webhook reconciliation in the existing services. If both apps later share cart creation, a backend extraction should be designed explicitly rather than maintaining two business-rule implementations.

1. Require the canonical STREET user and their saved address. Preserve selected outlet and real Shopify variant IDs; never substitute product IDs for variants.
2. Obtain `/orders/delivery-price` and existing pricing/configuration. This endpoint currently returns a configured flat fee, not a live courier quote.
3. `POST /orders` with `{variants:[{vendorId,productId,variantId,quantity,price}],addressId,totalPrice}`. Persist returned `ST-...` order identifier before leaving the website.
4. Create Shopify Storefront cart using the vendor configuration and exact existing attributes: `STREET Checkout=Yes`, `STREET Order=<ST-...>`, `STREET Outlet=<Shopify location GID>`, `STREET Location=<branch>`, delivery instructions and coordinates. Prefill buyer identity/address using the existing mobile contract. Validate current Shopify API details through Shopify Dev MCP before implementing.
5. Open the returned hosted `checkoutUrl`. Preserve recovery state across reload/navigation. A browser return or closed tab is not proof of payment or cancellation. A guaranteed automatic redirect is not established by the current integration.
6. Read the authenticated STREET order to confirm webhook-observed payment/order state; show a pending state while processing. Display payment authorization separately from capture when applicable.

Evidence: `street-client-app/lib/app/core/services/storefront_api_service.dart:145,232`; `shopify_checkout_service.dart:257`; `street-backend/src/modules/v1/orders/orders.controller.ts:42`; `orders/services/orders.service.ts:2135`; `street-shopify-app/src/modules/webhook/webhook.controller.ts:449,590`; `src/modules/billing/services/payment-reconciliation.service.ts:85`.

Before enabling checkout, validate these existing gaps in staging:

- Initial order payload contains no outlet; webhook/cart attributes supply it. Missing/invalid location can fall back to the primary outlet. One-outlet validation must be preserved throughout.
- Initial order pricing uses supplied item prices; Shopify later provides authoritative paid totals. Do not treat browser totals as authoritative or present pending orders as paid.
- Order creation has no request idempotency key. Do not automatically retry mutations after ambiguous timeouts; retain pending attempts and provide recovery. UI button disabling alone is not end-to-end idempotency.
- Saved STREET address and an address edited in Shopify checkout may diverge: existing link path updates pricing/outlet metadata but retains the initial address. Resolve this before fulfilment testing.
- Shopify shipping-rate configuration and backend flat fee must agree; do not introduce a third hardcoded fee.
- Stock/quantity/outlet eligibility and vendor-to-order linkage need explicit server-side verification before broad checkout availability. Existing webhook status claims prevent duplicate retailer notification but are not comprehensive creation idempotency.

## Staging work sequence

1. Foundation complete locally: Next.js runtime, staging API/session boundary and OTP account page. Shopping screens are now React components using staging data.
2. Read-only retailer discovery, outlet catalogue, product variants and nearby search are connected (TT-508). Global retailer browsing uses the backend primary-outlet listing; search uses explicit browser coordinates. Saved addresses and a complete location picker remain subsequent work.
3. Add phone OTP, existing profile, addresses and favourites. Prove the cross-device identity acceptance tests. Add Google only with configured staging web OAuth credentials and the explicit linking limitations addressed.
4. Implement real variants, one-outlet cart, stock revalidation and delivery eligibility; then Shopify checkout recovery/order history. Resolve the checkout gates above before creating test payments or courier jobs.
5. Reuse tracking and shared operational settings, verify mobile app handoff behaviour and accessibility. The earlier proposal to allow mobile browsing but direct purchasing to the app remains a product decision, not an implemented policy.
6. Configure a staging repository/hosting target and access protection. Confirm environment, tag/runbook requirements for any backend changes, test merchant/payment/courier controls and rollback before deployment. No production changes are authorized by this project.

## Verification completed

- Copied 30 tracked source/assets files; original PoC unchanged.
- Copied baseline `npm run build` passes all four inherited unit tests. These test the mock model, not live integrations.
- Read-only `GET /v1/vendors?limit=2` returned HTTP 200 and localhost CORS permission; listing metadata reported 10 staging vendors.
- Read-only outlet-scoped product request returned HTTP 200, 30 products in metadata and populated category facets for one staging retailer. No signup, user-data mutations, orders, Shopify cart, payments or courier jobs were created.
- Live checks establish reachability and one catalogue contract only, not complete compatibility or delivery eligibility.

## Discovered issues

- TT-505 (urgent): Apple login trusts request email for account lookup and lacks audience enforcement. Source verified; no exploit attempted. Fix/review before enabling this method on web.
- TT-506 (high): public product response embeds full vendor projection including contact/internal fields; confirmed in local source and a public staging read. Reuse public projection in backend and explicitly select needed fields in the web adapter.

Both issues are recorded separately in Linear; no backend code or deployment changed during discovery.

## Foundation verification update — 2026-10-30

Next.js production build and strict TypeScript checks pass. Unit tests exercise the inherited cart model and the new API/session boundary using injected upstream responses. Browser checks cover original navigation, bag, route unmount/remount, layout switching, desktop/mobile sizing and the account page. The local Next.js `/api/catalogue/vendors` route returned HTTP 200 with 10 staging retailer cards and no private vendor fields or credentials. No real OTP request, customer creation or checkout was used for verification. Authentication across web and staging mobile remains an explicit end-to-end acceptance check.

Before public staging sharing, configure access protection and confirm OTP rate limiting behind the server layer. The current backend sees the server's connection IP; do not trust arbitrary incoming forwarded IP headers as a shortcut.

## Shared favourites update — 2026-10-30 (TT-507)

User reports existing-account OTP sign-in succeeded on desktop and staging mobile. Desktop Saved previously used only the PoC in-memory sample list. It now links to `/saved`, reading existing authenticated product/outlet favourites through `/api/favourites`, with catalogue enrichment, bounded pagination, expired-session recovery, focus/manual refresh and explicit unavailable/error states. Sample heart actions were removed instead of mixing fictional IDs into real favourites. This is a read-only slice; no favourite mutations or backend changes. Unit/build and fixture browser verification passed; the user subsequently confirmed their favourites appear on desktop.

## Connected catalogue — 2026-10-30 (TT-508)

The main React shopping flow now consumes staging data. `/api/catalogue/browse` exposes only validated product-list, product-detail and search operations, with explicit field projections. Outlet location GIDs are mandatory for product calls; mirror product UUIDs and Shopify variant IDs remain distinct. No upstream vendor credentials/private fields are returned. All upstream calls remain fixed to staging and no-store.

The hybrid hero/video and distinct neighbourhood stories remain. Fictional catalogue/cart and layout comparison controls are no longer mounted. Saved links require a listed shop location before navigating to a product. An absent saved outlet is not substituted with the vendor primary outlet. Favourites remain read-only through the existing Saved page; catalogue heart state/editing is a later slice.

Search uses explicit browser geolocation permission and the existing backend search service; no new geocoding provider. Coordinates remain in memory, clear on a full reload/page exit and are omitted from navigation URLs. Neighbourhood editorial is independent of delivery eligibility. Retailer listings without coordinates show primary outlets, while nearby search may return other eligible outlets. Full saved-address/outlet selection remains open.

Verification: 30 unit tests cover projections, input/coordinate validation, ID preservation, staging enforcement and existing session/favourites boundaries. Production build and TypeScript pass. Live read-only browser checks cover the real retailer → outlet catalogue → product flow (Nobody’s Child Soho, £159 coat, XS stock 3), desktop/mobile layout, nearby search with a simulated Soho location, search-location retention, permission denial, fixture outage/empty results, home navigation and disabled checkout. No account writes, order/payment creation or backend deployment occurred.

## Saved addresses and shared favourite editing — 2026-10-30 (TT-509)

`/api/customer-context` projects the authenticated customer’s saved addresses and product/outlet favourite references. The shared React account provider refreshes on focus/session changes, clears selection on account change/sign-out, and updates favourite state only after confirmed success. Changes synchronize across catalogue, detail and Saved. The same backend product/outlet mutation endpoints are used; desired-state removal treats an already-absent favourite as success. Only explicit 401 responses trigger session refresh/retry; ambiguous network/5xx mutations are never retried automatically.

The address picker requires explicit selection and does not change the account default. Missing coordinates disable selection. Private routes resolve address ownership server-side before using persisted coordinates for nearby shop/search queries. Selection is memory-only and survives client navigation; creating/editing addresses still happens in the app.

`/api/delivery-check` traverses backend vendor pagination, including empty outlet pages, and matches exact vendor/outlet IDs before fetching opening status. This reuses backend service-area/discovery rules without duplicating radius constants. It is not courier availability or a delivery guarantee. The bounded scan returns unknown if incomplete, never a false outside-area result. Checkout remains disabled.

Verification: 37 unit tests and production build pass. Fixture-only browser checks cover saved-address selection without GPS, missing-coordinate addresses, independent branches, product state across catalogue/detail/Saved, failed-write retention and mobile sizing. Personal staging addresses/favourites were not modified. Real-account acceptance still needs the user to choose an existing address and confirm a web favourite change appears in the app.

## One-outlet cart — 2026-10-30 (TT-510)

The React `/bag` flow now stores a local cart per canonical account and staging environment, matching mobile’s per-user local persistence. Product/variant UUID/Shopify IDs are kept distinct. Exact variants merge quantities; a different outlet (including the same brand’s other branch) requires explicit Keep/Replace confirmation. Sign-out/account switch hides prior account state. Cached prices are unconfirmed display references only.

`POST /api/cart/check` performs authenticated read-only staging requests, not order creation. It resolves saved-address ownership and exact outlet tuple through backend geo discovery, then verifies each product against the vendor/outlet catalogue before reading variant stock and price. It never trusts a supplied location GID, unit price, total or customer ID. Unknown/incomplete scans and request failures cannot become valid subtotals. Changes and one-minute expiry invalidate checks; stale responses from previous cart/address/account selections are ignored. No automatic checkout, Shopify cart or courier calls are present.

Backend findings: TT-511 tracks detail product/vendor/location ownership and eligibility validation; TT-512 tracks global allocation-cap reapplication after location-specific resolution. Cart validation compensates for missing membership checks by using the scoped list, and respects reported stock conservatively. These remain checkout gates, alongside the previously documented order/idempotency/address reconciliation concerns.

The user confirmed TT-509 address selection and favourite removal. The mobile app requires restart to reflect a removed favourite; the user explicitly deferred that refresh issue. No mobile changes were made.

Cart verification: 44 tests and the production build pass. Fixture browser checks cover required variant selection, merged quantities, reduced stock, price changes, failed checks without stale totals, explicit Keep/Replace across branches, account isolation, persistence after reload, removal and mobile layout. The signed-out local check route correctly rejects unauthenticated requests. No real order, payment or account mutation occurred. Real-account cart acceptance remains to be confirmed by the user.

## Deferred cross-device bag requirement — 2026-10-30

The user explicitly wants to add to a bag on desktop and complete the purchase in the app under the same account (and vice versa). This requires a shared account-owned backend cart plus mobile/web synchronization; current local bags are an interim foundation choice, not the intended final experience. Track as a separate backlog feature after the core foundation, including local-bag reconciliation, concurrent/offline edits, one-outlet enforcement and checkout revalidation. Do not expand the current foundation scope to implement synchronization.

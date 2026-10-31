# STREET marketplace

Next.js 16 / React 19 / TypeScript foundation for the customer marketplace. Staging only. The approved PoC design is retained; the original `street-desktop-poc` repository is unchanged.

## Run locally

Use Node 22.18+ (native TypeScript test support).

```sh
npm ci
npm run dev
```

Open http://localhost:4319. The server is running locally after foundation verification. For a production-mode local check, run `npm run build` followed by `npm start` instead of the dev server.

```sh
npm test
npm run typecheck
npm run build
```

## What works now

- Next.js App Router, TypeScript, dependency lockfile and Vercel Next.js configuration.
- React shopping pages now use real staging retailers, outlet catalogues, product images, variant prices/stock and nearby search. The hybrid hero/video and neighbourhood editorial remain. The comparison layouts and mock bag are retained only in the inactive PoC source (`app.js`); they are not served by the marketplace.
- `/account`: phone OTP sign-in/signup using the existing STREET backend, session loading, refresh and logout. Requesting a code sends a real verification text through staging. Tests never send texts or create users.
- `/saved`: reads real product and outlet favourites from the signed-in staging account, with catalogue names/images, pagination, refresh-on-focus, manual Refresh, and signed-out/error states. Saved entries link into explicit shop-location selection; missing saved branches are never replaced with another outlet. Products and shop locations can now be saved/removed from the catalogue, product detail and Saved pages using the same backend favourites as the app.
- `/api/catalogue/vendors?page=1`: read-only live staging retailer/outlet adapter, explicitly projecting customer-facing fields. The homepage and Shop all consume this endpoint. Without coordinates, the backend lists primary outlets; nearby search can return other eligible outlets.
- `/bag`: one-outlet cart, keyed by actual variant ID, persisted locally per staging account. Different branches require explicit replacement. Quantities/removal work without creating an order. The bag is device-local, like the app, not synchronized across devices.
- `/api/cart/check`: authenticated, same-origin read-only check. An owned saved address resolves the backend-listed outlet/location. Product membership is checked in that outlet’s vendor catalogue before fresh detail reads; current prices/stock come from the backend, never browser totals. Unknown/failed checks do not produce a confirmed subtotal. Delivery charges and checkout remain deferred.
- All STREET upstream calls are fixed to `https://staging-api.street.london/v1` in `lib/server/config.ts`. No production environment override or fallback.

## Session boundary

The server routes exchange OTP and session credentials with STREET. Access/refresh tokens are stored in host-only HttpOnly, SameSite=Lax cookies, Secure outside local development. Tokens never appear in browser JSON, localStorage, URLs or logs. The backend remains responsible for identity and authorization; there is no new customer database or identity provider.

Mutation routes require matching Origin and JSON, validate allowed fields and bound request size. Explicit upstream methods use no-store, a timeout and no redirect following or automatic mutation retries. Session responses are private/no-store. Logout revokes the current backend session before clearing cookies; on an upstream outage it reports failure and permits retry. Guest session checks do not issue a refresh. Expired sessions refresh once through the POST endpoint, then retry the session read.

`MARKETPLACE_ORIGIN` can pin the exact deployed staging origin. Leave it unset for local development and host-specific previews; then the request URL supplies the same-origin boundary. `.env.example` contains no secrets. Preview access protection still needs configuring before sharing real customer functionality. The backend's current IP-based auth rate limits see server-side requests from the marketplace host; verify the trusted-client-IP/rate-limit approach before public rollout, without blindly forwarding client-supplied IP headers.

| Browser endpoint         | Method                                                        | Existing STREET endpoint                                                                      |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/api/auth/request-otp`  | POST `{phone}`                                                | `/auth/request-otp`                                                                           |
| `/api/auth/verify-otp`   | POST `{phone,code}`                                           | `/auth/verify-otp`                                                                            |
| `/api/auth/session`      | GET                                                           | `/auth/me`                                                                                    |
| `/api/auth/refresh`      | POST `{}`                                                     | `/auth/refresh` using server-held cookie                                                      |
| `/api/auth/logout`       | POST `{}`                                                     | `/auth/logout` using server-held cookie                                                       |
| `/api/catalogue/vendors` | GET `?page=1`                                                 | `/vendors?page=1&limit=12`                                                                    |
| `/api/catalogue/browse`  | GET validated `kind` plus validated filters and filters       | Existing outlet-scoped `/vendors/:id/products`, `/vendors/:id/products/:productId`, `/search` |
| `/api/cart/check`        | POST vendor/outlet/address IDs and product/variant quantities | Existing address, nearby vendor, catalogue and detail GETs only                               |
| `/api/customer-context`  | GET, authenticated                                            | `/auth/me`, `/user-addresses`, existing favourite lists; safe projection                      |
| `/api/favourites/change` | POST target + desired `saved` state                           | Existing `/favorites/products` or `/favorites/vendors` POST/DELETE                            |
| `/api/delivery-check`    | GET address/vendor/outlet IDs, authenticated                  | Owned address → paginated nearby `/vendors` → matched outlet `/online-status`                 |
| `/api/favourites`        | GET `?productsPage=1&shopsPage=1`                             | `/favorites/products`, `/favorites/vendors`, then catalogue detail reads                      |

There are no generic proxy routes, checkout/order mutation routes, test-login bypasses or Apple/Google routes in this foundation.

## Current boundaries and next slice

The catalogue uses staging data with explicit loading, error, empty and unavailable states. Global product search accepts a saved STREET address or browser location. The address picker reads the existing account address book, disables entries with missing coordinates, and never changes the account default. Saved-address IDs are resolved against the signed-in account on the server before filtering shops/search or checking an outlet. Address selection stays in memory across client navigation and clears on reload/sign-out. Browser geolocation remains in shared memory across client navigation and clears on reload/sign-out. The shared desktop-sticky header keeps search, location and navigation available on Discover, Profile, Favourites and Bag. Its location button opens a keyboard-accessible picker for current-device location and saved addresses; the old inline address picker is removed. Neither address IDs nor coordinates are put in navigation URLs or persistent browser storage. Neighbourhood guides do not set a delivery location. Saved products require a shop selection before stock is shown; a saved branch absent from the backend listing is reported unavailable on that page rather than replaced.

Profile/address creation and editing, Shopify checkout, tracking and mobile app purchase handoff remain unimplemented. Add or correct addresses in the app, then refresh them here. Service-area checks reuse backend discovery rules and opening status for the exact outlet; they do not guarantee courier availability or delivery. No deployments, payments, orders or courier jobs have been created. Favourite changes are real staging account writes when you use the controls; verification used fixtures only.

The user confirmed existing-account OTP login on desktop/staging mobile and confirmed their favourites appear on desktop. This verifies the observed shared-account flow; new-account and cross-provider deduplication still need separate acceptance checks. Canonical user-ID comparison has not been independently performed. Apple enablement depends on TT-505. See [INTEGRATION-PLAN.md](INTEGRATION-PLAN.md) for remaining gates.

`vercel.json` now selects Next.js and its server runtime; do not deploy the old `dist/` directory. No remote marketplace repository or hosting project is configured. The retired `server.mjs` and `build.mjs` fail with migration instructions instead of serving source or producing stale static builds. The old `index.html` is retained as source reference and is not served by Next.js. Only files under `public/` are served as static assets.

## Design provenance

Copied 30 tracked files from PoC commit `d6607ef8b005ce7cafcd62d7d6004876df550ec2`. Assets now live in `public/assets/`.

Hanson font and London photography were copied from `street.london/public/`. The expanded hybrid hero uses a user-supplied eight-second Kling product editorial, presented at its original 16:9 aspect ratio alongside the lime headline emphasis and primary shopping action. The complete edit is preserved in a 720p H.264 web copy (~1.8 MB), with audio removed for ambient playback. `assets/product-editorial-poster.jpg` is its opening frame. Playback is muted and inline, loops while visible, and pauses offscreen or in a hidden tab. A visible Play/Pause control is provided; reduced-motion users start on a still and can opt into playback. A failed video falls back to the still. The earlier `assets/high-street-style.png` campaign photo is retained for further comparison. Barlow (400, 500, 600, 700, Latin subset) is self-hosted from the same Google Fonts assets used by the marketing site. Both surfaces share Hanson/Barlow, Street lime, cream, black, and the 8px/12px control/surface shapes; the PoC keeps shopping-specific density and navigation. Decorative heading labels, image stamps and repeated product badges have been removed.

Illustrative product photos were downloaded from Unsplash:

- Knit: `photo-1434389677669-e08b4cac3105`
- Trainers: `photo-1549298916-b41d501d3772`
- Chair: `photo-1598300042247-d088f8ab3a91`
- Jewellery: `photo-1611652022419-a9419f74343d`
- Backpack: `photo-1553062407-98eeb64c6a62`
- Outerwear: `photo-1544923246-77307dd654cb`

Asset licensing, brand/product accuracy and product copy need review before any public use. These images are visual references, not a product feed.

Tracked in [TT-504](https://linear.app/street/issue/TT-504/street-marketplace-establish-staging-marketplace-and-map-shared-mobile). Original design source: [STREET-Technologies/street-desktop-poc](https://github.com/STREET-Technologies/street-desktop-poc).

## Shared favourites (TT-507)

The favourites adapter reads account-owned references with the server-held access token and projects only display fields. It does not accept a browser user ID. Product IDs and saved outlet IDs are retained; catalogue errors keep the saved entry visible. Details are fetched in bounded batches, up to 12 items per collection per page. Product metadata is display-only; no stock, price or checkout eligibility is inferred. Public vendor details describe the brand, so shop cards retain the saved outlet ID without incorrectly labelling it as the primary branch.

The shared client session helper retries authenticated reads once after refresh. No-store responses and refresh on returning to the tab prevent a permanent browser-local wishlist. The UI distinguishes a failed read from an empty list and clears old displayed items while reloading. Existing mobile favourites are never changed by viewing this page.

Verification: 25 unit tests and the production build pass. Browser tests exercised signed-out, populated, empty, failing and focus-refresh states with fixtures at desktop/mobile sizes. The user's personal list was not read or modified during automated verification.

## Cart boundaries

Sign in, choose a variant, then Add to bag. Choose a saved address in the bag to check stock/prices and the shop’s service area. Checks are invalidated by cart/address changes and expire after one minute; use the recheck button for fresh values. Stock is mirrored backend inventory, not reserved stock or a delivery guarantee. Quantity increases require a completed check with sufficient returned stock. Local cached prices are labelled as unconfirmed until checked.

Storage is namespaced by environment and canonical user ID, with no tokens or addresses. Sign-out/account changes hide the previous account’s bag; signing back in restores that account’s local bag. Switching outlets requires Keep/Replace confirmation. A staging request bound limits bags to 12 distinct variants and 99 units per line; backend availability may be lower. Corrupted local data is discarded. No order, Shopify cart, payment or courier operation is exposed.

Product-detail ownership/eligibility hardening is tracked in TT-511; a location-allocation cap inconsistency is tracked in TT-512. The web cart checks catalogue membership first and respects returned stock conservatively. Both need review before checkout enablement.

Product quick view (TT-516): ordinary catalogue/search card clicks open the live product in an image-led dialog, preserving the mounted listing, scroll position and focus. Variant, stock, favourites and bag controls reuse the full product component. Escape, close and backdrop dismiss the dialog; modified clicks and direct product URLs retain full-page behavior. Mobile stacks the image and controls in a scrollable dialog. Verified with isolated fixtures; no real account mutations.

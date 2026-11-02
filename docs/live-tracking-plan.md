# Web active-order tracking

2026-11-02 · TT-541 · Proposal following accepted TT-540 order history.

## Intended experience

Keep “Active orders” in Profile. Opening an active order shows a tracking view; completed orders retain Order Summary. Keep item, delivery and payment details available below tracking rather than replacing the existing summary implementation.

- Prominent current status and appropriate pickup/delivery ETA, when supplied.
- Mobile's progress stages: Order Placed → Store Accepted → Being Prepared → Ready for Pickup → Out for Delivery → Delivered. Pending/failed payment must not look like a placed, paid order.
- These are derived progress stages, not a timestamped history. Do not invent completion times.
- Before collection: preparation / waiting-for-rider / assigned / collecting copy, matching the app's delivery label mapper.
- Out for delivery: Mapbox map showing courier and destination, route, courier name, ETA and the customer's delivery PIN when supplied.
- Do not show a courier marker at an invented position. If location is absent, show a clear waiting state. Reassignment removes the previous courier marker.
- Connection interruption leaves the last known state visible with an updating/reconnecting notice. It must not present retained coordinates as confirmed current position.
- Declined, missed, cancelled, returning and returned states have distinct messaging; they must not continue along a successful-delivery rail. Delivered transitions to summary and refreshes the active/history lists.
- No new cancellation, returns submission, courier booking or refund actions.

## Reuse and approach

Recommended: existing authenticated REST snapshot plus existing Firebase RTDB updates and a lazy-loaded web Mapbox map. This matches the mobile integration without a second Stuart integration.

Alternative: REST polling only is simpler but loses delivery task/freshness fields and is less responsive. Use bounded polling only as recovery for an unavailable realtime connection, not the main tracking mechanism. Suggested interval 30 seconds for the single visible selected active order, with backoff; pause when hidden, stop on terminal/auth loss. Global backend throttle is 60/minute, so do not poll every card.

Do not use a provider tracking iframe/link as the primary view. Existing provider URL fields can contain merchant fallbacks; the app already implements STREET-owned tracking.

## Existing contracts verified in source

- GET /v1/orders/:publicReference returns UUID, status, pickup/delivery coordinates and delivery { jobId, status, courier/location, pickup/delivery ETA, pinCode }. Owner-scoped primary and Shopify fallback lookup. Extend the web server's explicit allowlist; never forward raw order/vendor data.
- POST /v1/auth/firebase-token is JWT guarded and mints an owner-scoped Firebase custom token. Add a same-origin server route using the existing HttpOnly STREET session. The browser receives a Firebase token, never the STREET access token or service credentials.
- Subscribe to orders/<UUID>, not orders/<ST-reference>. Checked-in staging rules permit owning customer/vendor/admin and deny client writes. Verify deployed staging rules with own/foreign-order tests before rollout; source is not deployment proof.
- RTDB carries status/statusUpdatedAt plus topic/task/courier/etaPickup/etaDelivery/updatedAt. One subscription service should serve list and selected tracking view; unsubscribe/reset on account change, logout and unmount. Use in-memory Firebase auth and one bounded token-remint retry for permission failure.
- PIN stays in authenticated customer REST only. Never copy it into the shared Firebase node. Refetch detail after real courier-job evidence if PIN is still missing, bounded like the app.
- Initial REST state must not regress because an older Firebase snapshot arrives. Explicit handling for terminal/return states, including RETURNING → RETURNED; do not rely on a numeric success-path rank for every status.

## Important scope boundary

The database already stores courier_location_at and delivery_events. No migration is needed for either.

The customer REST response and RTDB blob do not expose courier_location_at. RTDB updatedAt timestamps a state write, which may retain older coordinates. For this version, do not claim a precise “courier location updated N seconds ago.” A truthful coordinate-age indicator would be a small separately approved backend projection change. Retailer delivery endpoints expose location timestamps but are vendor-guarded and must not be used by the customer website.

The app's six milestones do not require a customer event-history endpoint. A timestamped audit timeline would be separate backend/API scope.

## Web setup and implementation sequence

1. Keep the accepted order-history work intact. Add shared tracking contracts, status/copy mapping and fixtures with tests for normal and off-path transitions.
2. Add customer-scoped Firebase custom-token route/client lifecycle. Verify staging project/database/config and access rules; keep sessions tied to STREET logout/account changes.
3. Add active tracking layout and realtime updates, with existing order summary secondary. Refresh list membership on terminal transitions.
4. Add lazy-loaded Mapbox web map using the existing public token shared with the mobile app (user confirmed 2026-11-02). Local comparison verified MAPBOX_ACCESS_TOKEN matches the mobile configuration and starts pk.; only public-scoped tokens may be returned by the authenticated tracking session route. Keep one configured value.
5. Debounce route fetches; mobile refetches after at least 50m courier movement. Dispose maps/listeners; avoid rebuilding map on every state update. Show provider attribution. Keep map/API failure independent from readable order status.
6. Test locally with fixtures, then a controlled Gymshark/Stuart staging order. No production operations or backend changes in this scope. Merge/deploy only after verification.

## Acceptance checks

- Pending payment; accepted; packing; ready; courier assigned; pickup; delivery; delivered.
- Correct pickup vs dropoff ETA and no “rider arriving” copy before courier evidence.
- Courier reassignment, missing coordinates, missing/present PIN, stale initial Firebase event, network loss/reconnect, tab hide/resume and expired session.
- Declined/missed/cancelled/returning/returned transitions and current totals after terminal REST refresh.
- Own-order access succeeds; foreign-order subscription/detail fails; logout removes subscriptions/private state. No client writes to RTDB.
- Desktop/mobile keyboard and responsive checks; map attribution; route throttling; no duplicate subscriptions or map instances.

## Evidence

Mobile: order_detail_page.dart (six-stage rail and IN_DELIVERY map gate), delivery_label_mapper.dart, compact_tracking_map.dart, firebase_realtime_service.dart, firebase_auth_service.dart.
Backend: orders/services/orders.service.ts; auth/services/firebase-token.service.ts; retailer/delivery-state/rtdb-blob.builder.ts; delivery-state.service.ts; scripts/firebase/rules.staging.json. Source reviewed in .worktrees/tt534-backend; no live services were changed.

Official web integration references:
- https://firebase.google.com/docs/auth/web/auth-state-persistence
- https://firebase.google.com/docs/reference/js/auth
- https://docs.mapbox.com/help/getting-started/access-tokens/
- https://docs.mapbox.com/help/dive-deeper/how-to-use-mapbox-securely/

## Local implementation verification — 2026-11-02

Implemented on feat/shared-order-history, not deployed. All 107 unit tests and the production build pass. Browser fixtures exercised Firebase custom authentication and WebSocket status events through preparation, delivery, return and completion; verified PIN visibility, receipt placement, active-list refresh and mobile overflow. The real Mapbox map and Directions route rendered using the existing public token. Mapbox telemetry requests were blocked in the test environment; map tiles and routes loaded successfully.

Remaining acceptance: a real staging order to verify deployed Firebase ownership rules, custom-token authentication and Stuart courier updates end to end. Fixtures are not evidence of live Firebase permissions. No orders, courier jobs, backend changes or deployments were created by these checks.

## Staging acceptance — 2026-11-02

User confirmed a real staging order progressed through courier location/map availability to successful delivery. PIN visibility was then corrected to match the app: show the available owner-only PIN before pickup, below the rider name and above the map. Desktop Profile now uses the shared responsive tab component as a sidebar; mobile retains pills. All 108 tests, build and desktop/mobile browser checks pass. Release v0.1.5 approved for merge and push. Deployed foreign-order Firebase permission checks remain unverified; source rules and session isolation tests were reviewed.

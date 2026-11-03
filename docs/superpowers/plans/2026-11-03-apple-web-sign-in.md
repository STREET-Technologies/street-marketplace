# Apple web sign-in implementation

Approved scope: shared secure Apple authentication, web flow and explicit mobile account confirmation, staging only. Database foundation deployed as backend v5.50.4. No automatic email linking or new Apple accounts in this pilot.

- Backend owner: provider verification/code exchange, atomic Redis challenges, encrypted credentials, explicit identity binding, lifecycle and tests. Existing branch feat/tt-531-apple-identity.
- Mobile owner: isolated staging-gated native challenge flow and signed-in confirmation; no production cutover.
- Web owner: same-origin BFF with HttpOnly Strict transaction cookie/state, official Apple JS button, shared STREET session, link/recovery copy and tests.
- Contract: POST /auth/apple/challenge {platform:web|ios,intent:login|link}; response challengeId/nonce/expiresIn/clientId/redirectUri. Native nonce passed verbatim. POST /auth/apple/token or /auth/apple/link accepts challengeId/authorizationCode/identityToken. Link requires signed-in account. No arbitrary client IDs, redirects, user IDs or email passed by browser.
- Verify provider-negative cases, account conflicts, replay, session handoff, popup cancellation/retry, mobile tests and web build/browser fixtures. No real provider acceptance claim until Services ID/key configuration and same-account test pass.
- Deployment and activation remain separate. Coordinate mobile build before strict backend cutover; older mobile Apple requests must not silently retain insecure fallback.

Verification 2026-11-03: marketplace 134 tests and production build pass. Browser fixtures pass cancellation, conflict/retry, keyboard login, same-account handoff, explicit linking and 320px overflow check. Actual Apple-hosted SDK/button rendered at 265x44 on mobile and keyboard cancellation submitted once using stubbed provider result; no real Apple account login performed.

Backend owner verified 94 focused tests/build; independent review reproduced and fixed revoked-refresh resurrection after relink using encrypted session generations and locked Redis rechecks. Baseline geocoding TS2339 remains unrelated. Mobile bridge verified 26 final focused tests after correcting real API envelope handling; existing 38-test regression run preceded that fix. Independent review accepted both fixes.

Activation still blocked on Services ID/group, server signing/encryption configuration and coordinated mobile staging build. Staging configuration presence check found no Apple server variables configured. Native login currently works against old deployed endpoint; new implementation is not deployed. Do not claim provider end-to-end verified. BFF shared-IP throttle verification tracked in TT-548.

# Apple sign-in: shared account security and web access

Status: existing-account staging pilot implemented and accepted on 2026-11-07. Marketplace v0.1.16, backend v5.50.7 and mobile staging build 1.0.11+125 support verified Apple linking/login across web and mobile. Same-account data and deletion cleanup verified. New Apple signup is deferred to a separate branch/session; production is unchanged. See docs/apple-web-sign-in-setup.md for current acceptance and remaining provider lifecycle checks.

## Intent and approved direction

An existing mobile Apple customer must reach the same STREET account, orders, addresses and wishlist on the marketplace. The user approved following Apple's recommended security approach and correcting the shared Apple backend, staging first. Avoid email-only account merging, duplicate users, changes to Google/OTP behaviour and an unrelated authentication redesign.

## Evidence

Backend origin/master abd7a83 verifies Apple signature/issuer/expiry, but not audience or nonce. It accepts request email ahead of signed email and ignores the authorization code. Its Apple path calls the same email-based creation helper as Google. Apple subject is read but not persisted. users.email is nullable/nonunique and is editable without verification; ssoProvider can be overwritten by another login method. These rows cannot establish historical Apple-subject ownership. TT-505 tracks verification; TT-532 tracks broader cross-provider linking, which remains separate.

## Approaches

1. Add only a web button with extra web validation: insufficient, because the shared mobile endpoint and mutable-email matching remain.
2. Correct shared Apple verification and introduce Apple-specific subject binding: recommended. Preserves the existing STREET user UUID and requires proof for legacy associations.
3. Redesign all providers around a general identity platform: unnecessary expansion for this iteration.

The user approved the security approach and database addition, then requested the Apple web flow. The legacy account transition below is part of that implementation; production cutover remains out of scope.

## Authentication flow

- Associate a website Services ID with the existing primary App ID/group used by com.streetlondon.app. Verify grouping in Apple Developer rather than infer it from the bundle ID. Register marketplace-staging.street.london and an exact HTTPS return URL. Local localhost cannot be Apple's registered redirect target; real provider testing uses staging HTTPS.
- Offer Apple alongside Google and OTP across supported web browsers, not only macOS. Use Apple's official JS/button presentation; popup cancellation is neutral, failure is retryable and existing methods remain usable.
- Backend creates a short-lived random challenge and nonce in Redis. Web uses Apple JS popup mode, receiving the result in its JS callback and sending a same-origin JSON POST to the web server. It does not accept a cross-site form POST as an interchangeable fallback. Web adds unpredictable state bound to a Secure, HttpOnly, SameSite=Strict, host-only browser transaction cookie; same-origin validation and state matching precede forwarding to the backend. Challenge/state/nonce are checked at their respective boundaries, with atomic single-use consumption and fail-closed Redis errors.
- Backend exchanges the single-use authorization code with Apple's token endpoint using a server-held client secret signed with the Apple key. Client ID and return URI come from trusted configuration, never arbitrary browser input.
- Validate identity token against rotating Apple public keys: supported signing algorithm, signature, issuer, exact permitted native/web audience, expiry, issued-at and transaction nonce. Bind code-exchange identity to the intended transaction and any accompanying identity token. Neither body email nor body userIdentifier can select an account.
- Names are optional, length-bounded untrusted profile input, supplied only on initial Apple authorization. Returning login cannot require the first-time user object. Verified relay email is accepted as contact information, not a stable account key.
- Reuse STREET's existing access/refresh session issuance and marketplace HttpOnly cookies. No Apple private key or provider refresh token is sent to browser storage or logs.

## Account binding and legacy transition

- Add one Apple-only apple_identities table: UUID primary key; unique userId foreign key to users; unique verified subject; encryptedCredentials text containing provider refresh credentials keyed by their allowed client audience; encryption key version; createdAt/updatedAt. Credentials use authenticated encryption with user/subject binding as associated data and are excluded from ordinary user responses. This table is the sole Apple identity lookup; do not add a duplicate subject column on users. Use verified Apple subject under the configured developer team/App ID group, not profile email. Do not invent a migration backfill from current email values.
- Returning bound users resolve to the existing STREET UUID regardless of later email edits. Load the current database user and reject disabled, anonymized or noncustomer accounts.
- A legacy association requires both a valid authenticated existing STREET customer session and a fresh challenge-bound Apple authentication, plus deliberate confirmation of the STREET account being linked. This authorizes a new association to that existing account; it is not evidence that this Apple subject historically created the account. A small explicit mobile confirmation flow provides both proofs for customers already signed in to the app. Re-read and bind in a transaction; unique constraints reject competing or already-owned subjects. Never merge two user rows.
- An unbound Apple login on web returns a clear confirmation/recovery requirement during the first existing-account pilot. It does not create a new account or automatically attach to an email match. New Apple signup is not enabled until the legacy/new-user distinction and recovery policy are approved.
- Customers signed out everywhere with no stored subject need a deliberate recovery process. This is an activation dependency: do not advertise seamless universal Apple access while these customers would be stranded. Do not require a legacy customer to restart their history.
- Native rollout must be coordinated: do not enable the strict cutover merely because a compatible app update exists. For the staging pilot, use updated test builds and explicitly disable legacy Apple login at cutover; existing authenticated STREET sessions remain usable for confirmation. Production requires an approved recovery path and old-client update/cutover plan first. The existing mobile request already carries an authorization code; its exact release compatibility still needs tests. Avoid maintaining an insecure fallback which bypasses the subject-binding policy.

## Provider lifecycle and deletion

Retain Apple refresh credentials encrypted in apple_identities, associated with their configured client audience, for server validation/revocation. Integrate account deletion with Apple token revocation without exposing credentials through User serialization. Handle signed Apple consent-revoked/account-deleted notifications and stop issuing STREET sessions from revoked bindings. A provider outage must not prevent fulfilling account deletion; bound any secure retry retention and follow Apple's documented manual-revocation fallback when credentials are unavailable. These are implementation requirements, not claims that existing lifecycle support is complete. Do not broaden Google/OTP linking as part of this work.

## Configuration needed

- Apple Services ID; verified primary App ID/group; native bundle audience(s).
- Apple Team ID, signing Key ID and Sign in with Apple private key via server secret configuration (never chat/repository/browser).
- Exact registered staging HTTPS return URL; registered route /api/auth/apple/callback for popup configuration; the login exchange itself uses a separate same-origin JSON endpoint. No general redirect fallback is included in this iteration.
- Any encryption key required by provider-credential retention.

## Implementation and verification sequence

1. Confirm this schema/legacy-transition scope and Apple console setup. Inspect live staging schema read-only before authoring a migration. Use an isolated backend worktree because its root checkout contains unrelated work.
2. Implement and test shared Apple verifier, challenge/code exchange and subject binding. Keep web configuration disabled until prerequisites are complete.
3. Implement the mobile confirmation bridge and web login handoff; reuse session/UI contracts. Add a clear legacy-confirmation/recovery state.
4. Test invalid signature/issuer/audience/nonce/state, expired/replayed codes, unavailable Redis/Apple, duplicate subjects and concurrent binding, caller-supplied identity overrides, disabled/deleted users, popup cancellation and relay-email accounts. Confirm existing Google/OTP regressions remain green.
5. Test the same bound customer on mobile and web, same canonical UUID and data, sign-out/back-in and profile email changes. Verify deletion/revocation policy before activation.
6. Separate approval and tagged staging deploy; no production changes. Apply additive schema changes before dependent application code. Rollback must account for newly bound users and must not restore the vulnerable Apple endpoint as a routine fallback; disabling Apple temporarily is safer than weakening verification.

## Sources

- https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web
- https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token
- https://developer.apple.com/documentation/signinwithapple/verifying-a-user
- https://developer.apple.com/documentation/SigninwithAppleRESTAPI/Generate-and-validate-tokens
- docs/web-social-sign-in-provider-research.md

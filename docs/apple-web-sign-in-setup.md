# Apple web sign-in: staging setup and acceptance

Implementation is staged locally across marketplace, backend and customer mobile branches. Database foundation is deployed on backend v5.50.4; the new authentication implementation is not deployed or activated yet.

## Apple Developer configuration

Use a website **Services ID** associated with the existing primary App ID/group for `com.streetlondon.app`. A working native Apple configuration alone does not configure web OAuth. Keep the existing grouping so the same Apple account has the same subject across native and web; verify this with an existing test account rather than assuming it from the console.

- Domain: `marketplace-staging.street.london` (no scheme/path in Apple's domain field).
- Return URL: `https://marketplace-staging.street.london/api/auth/apple/callback`.
- Share only Services ID, Team ID and Key ID as configuration identifiers. Install the Sign in with Apple `.p8` signing key through server secret configuration, never the repository, browser or chat.
- The registered return URL is for Apple JS popup configuration. The marketplace does not accept cross-site form-post authentication at that route. Its same-origin exchange endpoint establishes the STREET session.

## Environment configuration

Backend staging `.env` (see its `.env.template`):

- `APPLE_AUTH_ENABLED=true` only at coordinated staging cutover.
- `APPLE_WEB_CLIENT_ID=<website Services ID>`.
- `APPLE_WEB_REDIRECT_URI=https://marketplace-staging.street.london/api/auth/apple/callback`.
- `APPLE_NATIVE_CLIENT_ID=com.streetlondon.app` after checking existing native App ID/group.
- `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`: server-only signing configuration.
- `APPLE_CREDENTIAL_ENCRYPTION_KEY`: independently generated 32-byte base64 secret, securely backed up; changing it without migration makes existing credentials unreadable.

Marketplace Vercel:

- `MARKETPLACE_ORIGIN=https://marketplace-staging.street.london`.
- `APPLE_WEB_SIGN_IN_ENABLED=true` only after the backend configuration is ready.
- Do not add the private key to Vercel; the backend owns provider exchange and encrypted credential storage.
- Add `https://marketplace-staging.street.london` to the existing Google web client's authorised JavaScript origins as part of the domain move.

Customer mobile staging build:

- `APPLE_ACCOUNT_LINKING_ENABLED=true` in the staging asset environment.
- API host must be `staging-api.street.london`; production ignores this pilot flag.
- Install the updated build before the strict backend cutover. Existing old Apple login requests will no longer be accepted by the strict backend. Preserve an already signed-in test session for confirmation.

## Account confirmation and test sequence

1. Keep the existing test customer signed in on the mobile app. Update to the staging build without clearing app data.
2. In profile settings choose **Connect Apple**, confirm the displayed STREET account and complete fresh native Apple authorization. The current session refreshes normally; no sign-out is required.
3. On the website choose **Continue with Apple** using the same Apple account. Verify the canonical STREET user ID, addresses, wishlist and order history match.
4. Sign out/back in, change a profile email and verify Apple still selects the same account. Test popup cancellation, failure/retry and a relay-email account.
5. Verify unknown subjects show account confirmation/support guidance and create no duplicate account. New Apple signup is deliberately not supported in this pilot.
6. Test revocation/relink on a dedicated test account: pre-revocation refresh tokens must remain invalid after reconnection. Test account deletion separately; provider failure must not block deletion. Manual fallback: Apple Account → Sign in with Apple → STREET → Stop Using.

The backend signed notification endpoint is `/v1/auth/apple/notifications`. Verify ownership of the primary App ID/group notification setting before changing it: this may be shared with other environments. The implementation validates Apple's signature and configured audience, handles consent-revoked/account-deleted and invalidates old Apple session generations. Register and test delivery as part of activation; route shared-group events appropriately rather than redirecting an existing endpoint blindly.

Web challenge/link/token endpoints currently share the backend's IP throttle (5/min). BFF egress can aggregate multiple browsers into one bucket; verify this on Vercel before wider activation. Do not solve it by trusting arbitrary forwarded headers.

Real Apple testing needs the registered HTTPS origin. Local browser fixtures test the UI and BFF independently; they do not prove Apple console configuration or app/web subject grouping.

## Sources

- [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
- [Apple JS popup and state](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple)
- [Verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
- [Account notifications](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts)

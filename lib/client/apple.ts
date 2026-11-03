export type AppleResult = {
  authorization: { code: string; id_token: string; state: string };
};
export type AppleIdentity = {
  init: (config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state: string;
    nonce: string;
    usePopup: true;
  }) => void;
  renderButton: () => void;
  signIn: () => Promise<AppleResult>;
};
declare global {
  interface Window {
    AppleID?: { auth: AppleIdentity };
  }
}
let loading: Promise<AppleIdentity> | null = null;
export function loadAppleIdentity(): Promise<AppleIdentity> {
  if (window.AppleID?.auth) return Promise.resolve(window.AppleID.auth);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(
        new Error(
          "Apple sign-in couldn’t load. Try again or use another sign-in method.",
        ),
      );
    };
    const timer = window.setTimeout(fail, 12000);
    script.src =
      "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      const identity = window.AppleID?.auth;
      if (identity) resolve(identity);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}
export function appleCancelled(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "error" in error &&
    ["user_cancelled_authorize", "popup_closed_by_user"].includes(
      String(error.error),
    )
  );
}
export function appleProof(result: AppleResult) {
  const value = result?.authorization;
  if (
    !value ||
    typeof value.code !== "string" ||
    typeof value.id_token !== "string" ||
    typeof value.state !== "string"
  )
    throw new Error("Apple sign-in couldn’t finish. Please try again.");
  return {
    authorizationCode: value.code,
    identityToken: value.id_token,
    state: value.state,
  };
}

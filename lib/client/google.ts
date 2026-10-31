type CredentialResponse = { credential: string };
type GoogleIdentity = {
  initialize: (config: {
    client_id: string;
    nonce: string;
    callback: (response: CredentialResponse) => void;
    auto_select: boolean;
    ux_mode: "popup";
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      width: number;
    },
  ) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}
let loading: Promise<GoogleIdentity> | null = null;
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id)
    return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(
        new Error(
          "Google sign-in couldn’t load. Try again or sign in by phone.",
        ),
      );
    };
    const timer = window.setTimeout(fail, 12000);
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      const identity = window.google?.accounts?.id;
      if (identity) resolve(identity);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

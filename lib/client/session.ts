import type { Customer } from "../contracts";

export class SessionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function responseData(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new SessionError(
      response.status >= 400 ? response.status : 502,
      "STREET could not complete this request. Please try again.",
    );
  }
}

export async function sessionRequest(
  action: string,
  body?: Record<string, string>,
): Promise<{ user?: Customer; success?: boolean }> {
  const response = await fetch(`/api/auth/${action}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await responseData(response);
  if (!response.ok)
    throw new SessionError(response.status, data.error ?? "Please try again.");
  if (
    typeof window !== "undefined" &&
    ["verify-otp", "logout"].includes(action)
  )
    window.dispatchEvent(new Event("street:session-changed"));
  return data;
}

// Coalesce refresh in this browser only; no shared server/customer state.
let refreshing: Promise<unknown> | null = null;
async function withSessionRefresh<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof SessionError && error.status === 401)) throw error;
    refreshing ??= sessionRequest("refresh", {}).finally(() => {
      refreshing = null;
    });
    await refreshing;
    return read();
  }
}

export async function currentCustomer(): Promise<Customer | null> {
  try {
    return (
      (await withSessionRefresh(() => sessionRequest("session"))).user ?? null
    );
  } catch (error) {
    if (error instanceof SessionError && error.status === 401) return null;
    throw error;
  }
}

export function readAccountData<T>(
  path:
    | "/api/favourites"
    | "/api/customer-context"
    | "/api/delivery-check"
    | "/api/catalogue/vendors"
    | "/api/catalogue/browse",
  params: URLSearchParams,
): Promise<T> {
  return withSessionRefresh(async () => {
    const response = await fetch(`${path}?${params}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await responseData(response);
    if (!response.ok)
      throw new SessionError(
        response.status,
        data.error ?? "Unable to load your saved items.",
      );
    return data as T;
  });
}

export function postAccountData<T>(
  path:
    | "/api/favourites/change"
    | "/api/cart/check"
    | "/api/profile"
    | "/api/addresses/change",
  body: unknown,
): Promise<T> {
  return withSessionRefresh(async () => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await responseData(response);
    if (!response.ok)
      throw new SessionError(
        response.status,
        data.error || "STREET could not complete this request.",
      );
    return data as T;
  });
}
export function changeFavourite(
  target: import("../contracts").FavouriteTarget,
  saved: boolean,
): Promise<void> {
  // Only explicit 401 responses retry after refresh; ambiguous writes never retry.
  return postAccountData<void>("/api/favourites/change", { ...target, saved });
}

// Deliberately no environment override or production fallback in this foundation.
export const STAGING_API = "https://staging-api.street.london/v1";

export function stagingUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#]/.test(path)) {
    throw new Error("Invalid STREET API path");
  }
  const url = new URL(STAGING_API + path);
  if (
    url.origin !== new URL(STAGING_API).origin ||
    !url.pathname.startsWith("/v1/")
  ) {
    throw new Error("Only the STREET staging API is permitted");
  }
  return url;
}

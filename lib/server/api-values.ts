export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(502, "STREET returned an unexpected response.");
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new ApiError(502, "STREET returned incomplete data.");
  return value;
}
export const optionalString = (value: unknown) =>
  typeof value === "string" ? value : null;

export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

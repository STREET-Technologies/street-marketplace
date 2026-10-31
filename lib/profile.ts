import type { Customer } from "./contracts.ts";

// Mirror the app's persisted account-provider rules, not the current login method.
export function profilePermissions(user: Customer) {
  return {
    phone: Boolean(user.ssoProvider?.trim()),
    email: user.ssoProvider?.toLowerCase() !== "google",
  };
}

export type ProfileChanges = Partial<
  Pick<Customer, "firstName" | "lastName" | "email" | "phone">
>;
export interface AddressFields {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  deliveryInstructions: string;
}

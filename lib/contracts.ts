export interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ssoProvider?: string | null;
}

export interface OutletCard {
  vendorId: string;
  outletId: string | null;
  locationGid: string | null;
  name: string;
  outletName: string | null;
  category: string | null;
  image: string | null;
  logo: string | null;
  postcode: string | null;
  address: string | null;
  distanceMiles: number | null;
  isOnline: boolean;
}

export interface VendorPage {
  categories: string[];
  outlets: OutletCard[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SavedItem {
  key: string;
  vendorId: string;
  productId?: string;
  outletId?: string | null;
  name: string;
  shopName: string | null;
  image: string | null;
  status: "ready" | "unavailable" | "error";
}
export interface SavedPage {
  items: SavedItem[];
  page: number;
  total: number;
  totalPages: number;
}
export interface Favourites {
  products: SavedPage;
  shops: SavedPage;
}

export interface ProductCard {
  id: string | null;
  title: string;
  price: number | null;
  image: string | null;
  productType: string | null;
  vendorId: string;
  outletId: string | null;
  locationGid: string | null;
  shopName: string | null;
  outletName: string | null;
}
export interface ProductPage {
  facets: { productType: string; count: number }[];
  products: ProductCard[];
  page: number;
  total: number;
  totalPages: number;
  requiresLocation: boolean;
  outOfDeliveryArea: boolean;
}
export interface ProductDetail {
  options?: { name: string; values: string[] }[];
  id: string;
  title: string;
  description: string | null;
  images: string[];
  variants: {
    id: string;
    title: string;
    price: number | null;
    inventory: number | null;
  }[];
}

export interface SavedAddress {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  isDefault: boolean;
  state?: string;
  country?: string;
  countryCode?: string;
  deliveryInstructions?: string;
  coordinates: { latitude: number; longitude: number } | null;
}
export type FavouriteTarget =
  | { kind: "product"; vendorId: string; productId: string }
  | { kind: "shop"; vendorId: string; outletId: string };
export interface CustomerContext {
  userId: string;
  addresses: SavedAddress[];
  favourites: FavouriteTarget[];
}
export interface DeliveryCheck {
  status: "available" | "unavailable" | "unknown";
  isOpen: boolean | null;
}

export interface CartLine {
  optionLabels?: { name: string; value: string }[];
  productId: string;
  variantId: string;
  quantity: number;
  title: string;
  variantTitle: string;
  image: string | null;
  unitPrice: number;
}
export interface CartDraft {
  vendorId: string;
  outletId: string;
  shopName: string;
  branch: string;
  lines: CartLine[];
}
export interface CartIntent {
  vendorId: string;
  outletId: string;
  addressId: string;
  lines: { productId: string; variantId: string; quantity: number }[];
}
export interface CartReview {
  deliveryFee: number | null;
  total: number | null;
  userId: string;
  addressId: string;
  checkedAt: string;
  delivery: DeliveryCheck;
  lines: {
    productId: string;
    variantId: string;
    quantity: number;
    title: string | null;
    variantTitle: string | null;
    optionLabels?: { name: string; value: string }[];
    image: string | null;
    unitPrice: number | null;
    inventory: number | null;
    issue: "unavailable" | "stock" | "unknown" | null;
  }[];
  subtotal: number | null;
}

import { checkoutEnabled } from "../../lib/server/checkout-api";
import { CustomerPage } from "../../components/customer-page";
import Bag from "../../components/cart";
export const dynamic = "force-dynamic";
export default function BagPage() {
  return (
    <CustomerPage title="Bag">
      <Bag checkoutEnabled={checkoutEnabled()} />
    </CustomerPage>
  );
}

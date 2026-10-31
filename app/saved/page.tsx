import { CustomerPage } from "../../components/customer-page";
import Saved from "../../components/saved";
import "./style.css";
export default function SavedPage() {
  return (
    <CustomerPage title="Wishlist">
      <Saved />
    </CustomerPage>
  );
}

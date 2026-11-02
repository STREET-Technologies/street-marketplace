import { CustomerPage } from "../../components/customer-page";
import Account from "../../components/account";
import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";
export default function AccountPage() {
  return (
    <CustomerPage title="Profile">
      <Account />
    </CustomerPage>
  );
}

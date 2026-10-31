import { CustomerPage } from "../../components/customer-page";
import Account from "../../components/account";
import "./style.css";
export default function AccountPage() {
  return (
    <CustomerPage title="Profile">
      <Account />
    </CustomerPage>
  );
}

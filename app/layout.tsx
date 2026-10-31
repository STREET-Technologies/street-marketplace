import { CartProvider } from "../components/cart";
import { CustomerProvider } from "../components/customer-context";
import { Suspense } from "react";
import MarketplaceHeader from "../components/marketplace-header";
import type { Metadata } from "next";
import "../style.css";

export const metadata: Metadata = {
  title: "STREET — Marketplace staging",
  description: "STREET marketplace staging foundation.",
  robots: { index: false, follow: false },
  icons: { icon: "data:," },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CustomerProvider>
          <CartProvider>
            <a className="skip" href="#main">
              Skip to content
            </a>
            <div className="proof-strip">
              Staging · Real test catalogue · Purchasing disabled
            </div>
            <Suspense
              fallback={
                <div className="header-loading frame" role="status">
                  Loading STREET navigation…
                </div>
              }
            >
              <MarketplaceHeader />
            </Suspense>
            {children}
          </CartProvider>
        </CustomerProvider>
      </body>
    </html>
  );
}

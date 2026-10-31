import { Suspense } from "react";
import Marketplace from "../components/marketplace";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="frame">
          <p role="status">Loading STREET…</p>
        </main>
      }
    >
      <Marketplace />
    </Suspense>
  );
}

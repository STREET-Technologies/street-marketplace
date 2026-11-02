import { stockStatus } from "../lib/product-presentation";

export default function StockStatus({ inventory }: { inventory: number | null | undefined }) {
  const status = inventory === undefined ? null : stockStatus(inventory);
  return (
    <p role="status" className="stock-status" data-stock={status?.kind}>
      {status && <>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <path className="stock-status-mark" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            d={status.kind === "out" ? "m8 8 8 8m0-8-8 8" : status.kind === "unknown" ? "M12 7v6m0 4v.01" : "m7 12 3 3 7-7"} />
        </svg>
        <span>{status.label}</span>
      </>}
    </p>
  );
}

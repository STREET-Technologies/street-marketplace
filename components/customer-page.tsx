import type { ReactNode } from "react";
import Link from "next/link";
import NavigationIcon from "./navigation-icon";

export function CustomerPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="frame customer-page" id="main">
      <header className="customer-page-heading">
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}

// Mirrors the app's EmptyStatePrompt: one icon, title, message and optional action.
export function CustomerEmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon:
    | "profile"
    | "heart"
    | "bag"
    | "store"
    | "location"
    | "search"
    | "history"
    | "returns";
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <section className="customer-empty">
      <span className="customer-state-icon" aria-hidden="true">
        <NavigationIcon name={icon} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {children && <div className="customer-state-action">{children}</div>}
    </section>
  );
}

export function CustomerSignIn({
  icon,
  title,
  message,
}: {
  icon: "heart" | "bag";
  title: string;
  message: string;
}) {
  return (
    <CustomerEmptyState icon={icon} title={title} message={message}>
      <Link className="primary" href="/account">
        Sign In
      </Link>
    </CustomerEmptyState>
  );
}

// Loading visuals share the catalogue skeleton tokens and reduced-motion rule.
export function CustomerLoading({
  label,
  children,
  rows = 3,
}: {
  label: string;
  children?: ReactNode;
  rows?: number;
}) {
  return (
    <div className="customer-loading" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {children ?? Array.from({ length: rows }, (_, index) => (
          <div className="customer-loading-row" key={index}>
            <span className="skeleton-block skeleton-line skeleton-line--short" />
            <span className="skeleton-block skeleton-line skeleton-line--title" />
            <span className="skeleton-block skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

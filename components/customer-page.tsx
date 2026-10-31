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
  icon: "profile" | "heart" | "bag" | "store" | "location" | "search";
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

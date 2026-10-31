"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BagLink } from "./cart";

export default function HeaderActions() {
  const pathname = usePathname();
  const links = [
    { href: "/account", label: "Profile" },
    { href: "/saved", label: "Favourites" },
  ];
  return (
    <nav className="header-actions" aria-label="Your STREET">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="header-action"
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
      <BagLink active={pathname === "/bag"} />
    </nav>
  );
}

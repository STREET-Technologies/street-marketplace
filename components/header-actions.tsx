"use client";
import NavigationIcon from "./navigation-icon";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BagLink } from "./cart";

export default function HeaderActions() {
  const pathname = usePathname();
  const links = [
    { href: "/account", label: "Profile" },
    { href: "/saved", label: "Wishlist" },
  ];
  return (
    <nav className="header-actions" aria-label="Your STREET">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="header-action"
          aria-label={label}
          title={label}
          aria-current={pathname === href ? "page" : undefined}
        >
          <NavigationIcon name={href === "/account" ? "profile" : "heart"} filled={pathname === href} />
        </Link>
      ))}
      <BagLink active={pathname === "/bag"} />
    </nav>
  );
}

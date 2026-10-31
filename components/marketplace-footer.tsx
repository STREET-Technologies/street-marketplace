import Link from "next/link";

const marketingSite = "https://street.london";
const groups = [
  {
    title: "Explore",
    links: [
      { label: "Shop all", href: "/?view=shops" },
      { label: "Neighbourhoods", href: "/?view=neighbourhoods" },
    ],
  },
  {
    title: "STREET",
    links: [
      { label: "About STREET", href: marketingSite },
      { label: "For retailers", href: `${marketingSite}/retailers` },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Support & help", href: `${marketingSite}/support` },
      { label: "Contact us", href: `${marketingSite}/contact-us` },
    ],
  },
];

export default function MarketplaceFooter() {
  return (
    <footer className="marketplace-footer">
      <div className="frame">
        <div className="marketplace-footer-main">
          <div className="marketplace-footer-brand">
            <Link href="/" className="wordmark" aria-label="STREET home">STREET</Link>
            <p>Your high street.<br /><span>Delivered.</span></p>
          </div>
          <nav className="marketplace-footer-links" aria-label="Footer navigation">
            {groups.map(group => (
              <div key={group.title}>
                <h2>{group.title}</h2>
                <ul>
                  {group.links.map(link => (
                    <li key={link.href}>
                      {link.href.startsWith("/") ? <Link href={link.href}>{link.label}</Link> : <a href={link.href}>{link.label}</a>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="marketplace-footer-bottom">
          <p>© {new Date().getFullYear()} STREET. All rights reserved.</p>
          <nav aria-label="Legal">
            <a href={`${marketingSite}/privacy-policy`}>Privacy policy</a>
            <a href={`${marketingSite}/user-terms`}>Terms of use</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

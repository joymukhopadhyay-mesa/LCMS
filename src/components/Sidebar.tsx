"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

type Props = { pricingDue: number; hot: number };

const LINKS = [
  { href: "/", label: "Dashboard", icon: "home" },
  { href: "/leads", label: "Leads", icon: "leads", badge: "hot" as const },
  { href: "/leads?view=pricing", label: "Pricing due", icon: "rupee", badge: "pricing" as const },
  { href: "/calls", label: "All calls", icon: "phone" },
  { href: "/system", label: "System & costs", icon: "settings" },
];

export function Sidebar({ pricingDue, hot }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (query) return false; // query links are filters, the parent stays highlighted
    return path === "/" ? pathname === "/" : pathname.startsWith(path);
  };

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Icon name="phone" size={20} />
        </span>
        <span>
          <span className="brand-name">Lead Call</span>
          <span className="brand-sub" style={{ display: "block" }}>
            Management System
          </span>
        </span>
      </Link>

      <nav className="menu" aria-label="Main">
        <div className="menu-title">Main</div>
        <div className="menu-sub">Aangan Studio · phone enquiries</div>
        {LINKS.map((l) => {
          const n = l.badge === "pricing" ? pricingDue : l.badge === "hot" ? hot : 0;
          return (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : undefined}>
              <Icon name={l.icon} size={19} />
              {l.label}
              {n > 0 && (
                <span className="count" title={l.badge === "hot" ? "Hot leads" : "Leads waiting for a price"}>
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="side-note">
        Vaani answers every call, Gemini scores the qualified ones, designers get the brief on Telegram. Open to
        everyone in the studio, no login.
      </div>
    </aside>
  );
}

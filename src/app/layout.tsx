import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { Icon } from "@/components/Icon";
import { metrics } from "@/lib/repo";
import { ensureDemoData } from "@/lib/demo-seed";
import { fmtDate } from "@/lib/format";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], weight: ["300", "400", "600", "700"] });

export const metadata: Metadata = {
  title: "Lead Call Management System",
  description: "Aangan Studio - voice agent call qualification, lead scoring and pricing dashboard",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  ensureDemoData();
  const m = metrics();
  return (
    <html lang="en">
      <body className={nunito.className}>
        <div className="shell">
          <Sidebar pricingDue={m.pricingDue} hot={m.hot} />
          <div className="main">
            <header className="topbar">
              <div className="logo">
                <Icon name="menu" size={22} />
                <span>
                  LC<b>M</b>S
                </span>
              </div>
              <form className="search" action="/calls" role="search">
                <Icon name="search" size={16} className="muted" />
                <input name="q" placeholder="Search by name, locality, phone…" aria-label="Search calls" />
              </form>
              <div className="spacer" />
              <span className="clock">{fmtDate(new Date().toISOString())} · IST</span>
            </header>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

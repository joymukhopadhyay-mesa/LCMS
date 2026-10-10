"use client";

import { useRouter } from "next/navigation";

/** Table row that opens a lead. Clicks on links, buttons and form fields inside it are left alone. */
export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className="clickable"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, textarea, select, form")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}

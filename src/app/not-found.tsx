import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card empty" style={{ marginTop: 40 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Not found</h1>
      <p>That lead or page doesn&apos;t exist.</p>
      <Link href="/leads" className="btn">Back to leads</Link>
    </section>
  );
}

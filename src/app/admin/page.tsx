export const metadata = {
  title: "Admin Dashboard Prototype",
  description: "Operational dashboard prototype for instructor approvals, leads, and profile publishing."
};

export default function AdminPage() {
  const rows = [
    ["Applications", "18", "Review identity, media, service area, and event fit"],
    ["Approved profiles", "6", "Seed profiles currently published"],
    ["Open leads", "11", "Track buyer inquiries and instructor response"],
    ["Guarantee eligible", "4", "Founding members under first-year guarantee"]
  ];
  return (
    <section className="page-shell">
      <p className="eyebrow">Admin prototype</p>
      <h1>Approve instructors, manage profiles, and track leads.</h1>
      <p className="lede">This static dashboard defines the V1 operating surface. Connect it to Supabase auth, row-level policies, and Stripe subscription status before launch.</p>
      <div className="admin-grid">
        {rows.map(([label, value, detail]) => (
          <article key={label} className="metric-card">
            <span>{label}</span>
            <strong>{value}</strong>
            <p>{detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

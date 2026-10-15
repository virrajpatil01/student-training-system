const icons = {
  students: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  roles: "M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5l-8-3ZM9 12l2 2 4-4",
  trainers: "M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 21a7 7 0 0 1 14 0M16 11a4 4 0 1 0 0-8M19 14a5 5 0 0 1 2 4v3",
  batches: "M3 7h18M5 3h14v18H5zM8 11h8M8 15h5",
  assigned: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  unassigned: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
};

function KPICard({ label, value, detail, icon, tone }) {
  return (
    <article className="kpi-card">
      <div className={`kpi-icon kpi-icon-${tone}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d={icons[icon]}
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="kpi-label">{label}</p>
      <div className="kpi-value-row">
        <p className="kpi-value">{value}</p>
        {detail && <span className="kpi-detail">{detail}</span>}
      </div>
    </article>
  );
}

export default KPICard;

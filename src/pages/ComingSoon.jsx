function ComingSoon({ title }) {
  return (
    <section className="coming-soon-page">
      <p className="eyebrow">ADMIN WORKSPACE</p>
      <h1>{title}</h1>
      <div className="coming-soon-card">
        <span className="coming-soon-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2>Coming Soon</h2>
        <p>This section is not available yet. Check back soon.</p>
      </div>
    </section>
  );
}

export default ComingSoon;

import { Link } from "react-router-dom";

function Header({ onMenuClick, userEmail }) {
  return (
    <header className="admin-header">
      <button
        aria-label="Open navigation menu"
        className="mobile-menu-button"
        onClick={onMenuClick}
        type="button"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <Link className="header-brand" to="/dashboard">
        <span className="header-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="m3 9 9-5 9 5-9 5-9-5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M6.5 11v4.5c3.4 2.8 7.6 2.8 11 0V11M21 9v6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>Student Registration &amp; Training Management System</span>
      </Link>
      <div className="header-admin" title={userEmail || "Admin"}>
        <span className="admin-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="header-admin-name">Admin</span>
      </div>
    </header>
  );
}

export default Header;

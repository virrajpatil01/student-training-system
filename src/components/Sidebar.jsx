import { NavLink } from "react-router-dom";

const menuItems = [
  { label: "Dashboard", path: "/dashboard", icon: "dashboard" },
  { label: "Students", path: "/students", icon: "students" },
  { label: "Courses", path: "/courses", icon: "roles" },
  { label: "Trainers", path: "/trainers", icon: "trainers" },
  { label: "Batches", path: "/batches", icon: "batches" },
  { label: "Shuffle", path: "/shuffle", icon: "shuffle" },
  { label: "Schedules", path: "/schedules", icon: "schedule" },
  {
    label: "Registration Links",
    path: "/registration-links",
    icon: "links",
  },
  { label: "Reports", path: "/reports", icon: "reports" },
];

const iconPaths = {
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  students:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  roles:
    "M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5l-8-3ZM9 12l2 2 4-4",
  trainers:
    "M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.79.84l-.04.08h-3.4l-.04-.08a1.7 1.7 0 0 0-1.79-.84l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.08-.04v-3.4l.08-.04a1.7 1.7 0 0 0 .34-1.88l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.79-.84l.04-.08h3.4l.04.08a1.7 1.7 0 0 0 1.79.84l.08-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.08.04v3.4l-.08.04Z",
  batches: "M3 7h18M5 3h14v18H5zM8 11h8M8 15h5",
  shuffle: "m16 3 4 4-4 4M4 7h3a5 5 0 0 1 4 2l2 3a5 5 0 0 0 4 2h3M16 17l4-4-4-4M4 17h3a5 5 0 0 0 3-1",
  schedule:
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM8 14h3M8 17h6",
  links: "M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72",
  reports:
    "M4 19V5M4 19h17M8 16v-5M13 16V7M18 16v-8",
};

function MenuIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={iconPaths[name] || iconPaths.dashboard}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sidebar({ onNavigate, onLogout, loggingOut }) {
  return (
    <aside className="admin-sidebar">
      <p className="sidebar-section-label">WORKSPACE</p>
      <nav aria-label="Admin navigation" className="sidebar-nav">
        {menuItems.map((item) => (
          <NavLink
            className={({ isActive }) =>
              `sidebar-link${isActive ? " is-active" : ""}`
            }
            end={item.path === "/dashboard"}
            key={item.path}
            onClick={onNavigate}
            to={item.path}
          >
            <MenuIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className="sidebar-link sidebar-logout"
          disabled={loggingOut}
          onClick={onLogout}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{loggingOut ? "Signing out…" : "Logout"}</span>
        </button>
        <p className="sidebar-version">Student Training System</p>
      </div>
    </aside>
  );
}

export default Sidebar;

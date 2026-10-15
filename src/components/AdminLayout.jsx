import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth";
import Header from "./Header";
import Sidebar from "./Sidebar";

function AdminLayout() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError("");
    const { error } = await supabase.auth.signOut();
    setLoggingOut(false);

    if (error) {
      console.error("Supabase sign-out error:", error);
      setLogoutError("Unable to log out. Please try again.");
      return;
    }

    navigate("/login", { replace: true });
  }

  return (
    <div className="admin-app">
      <Header
        onMenuClick={() => setSidebarOpen((open) => !open)}
        userEmail={session?.user?.email}
      />
      <div className="admin-workspace">
        {sidebarOpen && (
          <button
            aria-label="Close navigation menu"
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        )}
        <div className={`sidebar-container${sidebarOpen ? " is-open" : ""}`}>
          <Sidebar
            loggingOut={loggingOut}
            onLogout={handleLogout}
            onNavigate={() => setSidebarOpen(false)}
          />
        </div>
        <main className="admin-main">
          {logoutError && (
            <p className="admin-alert" role="alert">
              {logoutError}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;

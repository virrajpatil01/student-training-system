import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./auth";
import { supabase } from "./supabase";

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const [sessionVerified, setSessionVerified] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function verifySession() {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) throw error;
        if (isMounted) setSessionVerified(Boolean(currentSession?.user));
      } catch (error) {
        console.error("Unable to verify protected-route session:", error);
        if (isMounted) setSessionVerified(false);
      }
    }

    verifySession();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading || sessionVerified === null) {
    return (
      <main className="auth-loading" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Checking your session…</span>
      </main>
    );
  }

  if (!sessionVerified) return <Navigate to="/login" replace />;
  return session?.user ? children : <Navigate to="/login" replace />;
}

export default ProtectedRoute;

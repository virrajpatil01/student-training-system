import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { AuthContext } from "./auth";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const authEventVersion = useRef(0);

  useEffect(() => {
    let isMounted = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      authEventVersion.current += 1;
      setSession(currentSession);
      setLoading(false);
    });

    async function loadSession() {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) throw error;
        if (isMounted && authEventVersion.current === 0) {
          setSession(currentSession);
          setLoading(false);
        }
      } catch (error) {
        console.error("Unable to verify Supabase auth session:", error);
        if (isMounted && authEventVersion.current === 0) {
          setSession(null);
          setLoading(false);
        }
      }
    }

    loadSession();
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

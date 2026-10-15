import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { supabase } from "./supabase";

function Login() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) {
    return (
      <main className="auth-loading" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Checking your session…</span>
      </main>
    );
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setErrorMessage("Enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }
    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setErrorMessage(
          error.message === "Invalid login credentials"
            ? "The email or password is incorrect."
            : error.message,
        );
        return;
      }

      if (!data.session || !data.user) {
        setErrorMessage("We couldn't start your session. Please try again.");
        return;
      }

      const {
        data: { session: verifiedSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (
        !verifiedSession?.user ||
        verifiedSession.user.id !== data.user.id
      ) {
        setErrorMessage("We couldn't verify your login session. Please try again.");
        return;
      }

      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Supabase sign-in error:", error);
      setErrorMessage("Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="brand-mark" aria-hidden="true">
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
        </div>
        <p className="eyebrow">ADMIN PORTAL</p>
        <h1 id="login-heading">
          Student Registration
          <br />
          &amp; Training Management System
        </h1>
        <p className="login-intro">Sign in to manage your training programs.</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="email">Email address</label>
          <input
            autoComplete="username"
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />

          <div className="password-label-row">
            <label htmlFor="password">Password</label>
            <button
              className="password-toggle"
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              disabled={submitting}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />

          {errorMessage && (
            <p className="login-error" role="alert">
              {errorMessage}
            </p>
          )}

          <button className="login-button" type="submit" disabled={submitting}>
            {submitting && (
              <span className="button-spinner" aria-hidden="true" />
            )}
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-footer">Secure access for system administrators</p>
      </section>
    </main>
  );
}

export default Login;

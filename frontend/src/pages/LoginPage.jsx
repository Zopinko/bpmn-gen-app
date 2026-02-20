import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { loginAuth } from "../api/auth";

const PENDING_INVITE_STORAGE_KEY = "PENDING_ORG_INVITE_TOKEN";

function LoginPage({ onLoginSuccess }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      await loginAuth({ email, password });
      if (typeof onLoginSuccess === "function") {
        await onLoginSuccess();
      }
      const pendingInviteToken =
        typeof window !== "undefined" ? window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY) : "";
      if (pendingInviteToken) {
        navigate(`/join-org/${pendingInviteToken}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (error) {
      setStatus({ loading: false, error: error.message });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Prihlasenie</h1>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="login-password">Heslo</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Prihlasujem..." : "Prihlasit sa"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          Nemas ucet? <Link to="/register">Zaregistruj sa</Link>
        </p>
      </form>
    </section>
  );
}

export default LoginPage;

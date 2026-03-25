import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { loginAuth } from "../api/auth";

const PENDING_INVITE_STORAGE_KEY = "PENDING_ORG_INVITE_TOKEN";

function mapLoginErrorMessage(statusCode) {
  if (statusCode === 401) {
    return "Nesprávny e-mail alebo heslo.";
  }
  if (statusCode === 429) {
    return "Príliš veľa pokusov. Skús to znovu o minútu.";
  }
  return "Prihlásenie sa nepodarilo. Skús to znovu.";
}

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
      let loggedInUser = null;
      if (typeof onLoginSuccess === "function") {
        loggedInUser = await onLoginSuccess();
        if (!loggedInUser) {
          throw new Error("Auth state was not established after login.");
        }
      }

      setEmail("");
      setPassword("");
      setStatus({ loading: false, error: "" });

      const pendingInviteToken =
        typeof window !== "undefined" ? window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY) : "";
      if (pendingInviteToken) {
        navigate(`/join-org/${pendingInviteToken}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (error) {
      const statusCode = Number.isInteger(error?.status) ? error.status : 0;
      setStatus({ loading: false, error: mapLoginErrorMessage(statusCode) });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">BPMN.GEN</p>
        <h1>Prihlásenie</h1>
        <p className="auth-intro">
          Pokračuj do svojho pracovného priestoru a nadviaž na rozpracované procesy.
        </p>

        <label htmlFor="login-email">E-mail</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="login-password">Heslo</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <p className="auth-link-row">
          <Link to="/forgot-password">Zabudnuté heslo?</Link>
        </p>

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Prihlasujem..." : "Prihlásiť sa"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          Nemáš účet? <Link to="/register">Zaregistruj sa</Link>
        </p>
      </form>
    </section>
  );
}

export default LoginPage;

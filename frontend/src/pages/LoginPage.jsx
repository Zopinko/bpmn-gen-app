import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { loginAuth } from "../api/auth";

const PENDING_INVITE_STORAGE_KEY = "PENDING_ORG_INVITE_TOKEN";

function mapLoginErrorMessage(statusCode, t) {
  if (statusCode === 401) return t("login.error_401");
  if (statusCode === 429) return t("login.error_429");
  return t("login.error_generic");
}

function LoginPage({ onLoginSuccess }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
      setStatus({ loading: false, error: mapLoginErrorMessage(statusCode, t) });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">{t("login.eyebrow")}</p>
        <h1>{t("login.title")}</h1>
        <p className="auth-intro">{t("login.intro")}</p>

        <label htmlFor="login-email">{t("login.email")}</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="login-password">{t("login.password")}</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <p className="auth-link-row">
          <Link to="/forgot-password">{t("login.forgot_password")}</Link>
        </p>

        <button type="submit" disabled={status.loading}>
          {status.loading ? t("login.submitting") : t("login.submit")}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          {t("login.no_account")} <Link to="/register">{t("login.register_link")}</Link>
        </p>
      </form>
    </section>
  );
}

export default LoginPage;

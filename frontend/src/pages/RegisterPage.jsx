import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackSignupCompleted } from "../api/analytics";
import { registerAuth } from "../api/auth";

function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setStatus({ loading: false, error: t("register.passwords_mismatch"), success: "" });
      return;
    }
    setStatus({ loading: true, error: "", success: "" });
    try {
      const result = await registerAuth({ email, password });
      const sid = new URLSearchParams(location.search).get("sid");
      void trackSignupCompleted(sid || undefined);
      setStatus({ loading: false, error: "", success: result?.message || t("register.success_generic") });
      setTimeout(() => navigate("/login"), 800);
    } catch (error) {
      setStatus({ loading: false, error: error.message, success: "" });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">{t("register.eyebrow")}</p>
        <h1>{t("register.title")}</h1>
        <p className="auth-intro">{t("register.intro")}</p>

        <label htmlFor="register-email">{t("register.email")}</label>
        <input
          id="register-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="register-password">{t("register.password")}</label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />

        <label htmlFor="register-confirm-password">{t("register.confirm_password")}</label>
        <input
          id="register-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={8}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? t("register.submitting") : t("register.submit")}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}

        <p className="auth-footer">
          {t("register.has_account")} <Link to="/login">{t("register.login_link")}</Link>
        </p>
      </form>
    </section>
  );
}

export default RegisterPage;

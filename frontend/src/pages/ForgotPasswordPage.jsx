import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { requestPasswordReset } from "../api/auth";

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "", success: "" });
    try {
      await requestPasswordReset({ email });
      setStatus({ loading: false, error: "", success: t("forgot_password.success") });
    } catch {
      setStatus({ loading: false, error: t("forgot_password.error_generic"), success: "" });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">{t("forgot_password.eyebrow")}</p>
        <h1>{t("forgot_password.title")}</h1>
        <p className="auth-intro">{t("forgot_password.intro")}</p>

        <label htmlFor="forgot-password-email">{t("forgot_password.email")}</label>
        <input
          id="forgot-password-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? t("forgot_password.submitting") : t("forgot_password.submit")}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}

        <p className="auth-footer">
          <Link to="/login">{t("forgot_password.back_to_login")}</Link>
        </p>
      </form>
    </section>
  );
}

export default ForgotPasswordPage;

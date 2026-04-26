import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resetPassword } from "../api/auth";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get("token") || "").trim(), [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [redirectSeconds, setRedirectSeconds] = useState(3);
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isStrongEnough = newPassword.length >= 8;
  const hasSuccess = Boolean(status.success);
  const canSubmit = Boolean(token) && passwordsMatch && isStrongEnough && !status.loading && !hasSuccess;

  useEffect(() => {
    if (!hasSuccess) {
      setRedirectSeconds(3);
      return undefined;
    }

    const countdownTimer = window.setInterval(() => {
      setRedirectSeconds((current) => (current > 1 ? current - 1 : current));
    }, 1000);
    const redirectTimer = window.setTimeout(() => {
      navigate("/login", { replace: true });
    }, 3000);

    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [hasSuccess, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!token) {
      setStatus({ loading: false, error: t("reset_password.missing_token"), success: "" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ loading: false, error: t("reset_password.passwords_mismatch"), success: "" });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ loading: false, error: t("reset_password.password_too_short"), success: "" });
      return;
    }

    setStatus({ loading: true, error: "", success: "" });
    try {
      await resetPassword({ token, new_password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setStatus({ loading: false, error: "", success: t("reset_password.success") });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.message || t("reset_password.error_generic"),
        success: "",
      });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">{t("reset_password.eyebrow")}</p>
        <h1>{t("reset_password.title")}</h1>
        <p className="auth-intro">{t("reset_password.intro")}</p>

        {hasSuccess ? (
          <div className="auth-success-panel">
            <p className="auth-message auth-message--success">{status.success}</p>
            <p className="auth-success-hint">{t("reset_password.redirect_hint", { seconds: redirectSeconds })}</p>
            <button type="button" onClick={() => navigate("/login", { replace: true })}>
              {t("reset_password.login_now")}
            </button>
          </div>
        ) : null}

        <label htmlFor="reset-new-password">{t("reset_password.new_password")}</label>
        <input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          minLength={8}
          required
          disabled={hasSuccess}
        />

        <label htmlFor="reset-confirm-password">{t("reset_password.confirm_password")}</label>
        <input
          id="reset-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={8}
          required
          disabled={hasSuccess}
        />

        {newPassword.length > 0 && !isStrongEnough ? (
          <p className="auth-message auth-message--error">{t("reset_password.password_too_short")}</p>
        ) : null}
        {confirmPassword.length > 0 && !passwordsMatch ? (
          <p className="auth-message auth-message--error">{t("reset_password.passwords_mismatch")}</p>
        ) : null}

        <button type="submit" disabled={!canSubmit}>
          {status.loading ? t("reset_password.submitting") : t("reset_password.submit")}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          <Link to="/login">{t("reset_password.back_to_login")}</Link>
        </p>
      </form>
    </section>
  );
}

export default ResetPasswordPage;

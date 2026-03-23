import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { resetPassword } from "../api/auth";

function ResetPasswordPage() {
  const navigate = useNavigate();
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
      setStatus({ loading: false, error: "Reset token chýba.", success: "" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ loading: false, error: "Heslá sa nezhodujú.", success: "" });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ loading: false, error: "Heslo musí mať aspoň 8 znakov.", success: "" });
      return;
    }

    setStatus({ loading: true, error: "", success: "" });
    try {
      await resetPassword({ token, new_password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setStatus({
        loading: false,
        error: "",
        success: "Heslo bolo úspešne obnovené.",
      });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.message || "Obnova hesla zlyhala. Vyžiadaj nový odkaz.",
        success: "",
      });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Obnova hesla</h1>

        {hasSuccess ? (
          <div className="auth-success-panel">
            <p className="auth-message auth-message--success">{status.success}</p>
            <p className="auth-success-hint">
              Presmerovanie na prihlásenie prebehne o {redirectSeconds} s.
            </p>
            <button type="button" onClick={() => navigate("/login", { replace: true })}>
              Prihlásiť sa teraz
            </button>
          </div>
        ) : null}

        <label htmlFor="reset-new-password">Nové heslo</label>
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

        <label htmlFor="reset-confirm-password">Potvrď heslo</label>
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
          <p className="auth-message auth-message--error">Heslo musí mať aspoň 8 znakov.</p>
        ) : null}
        {confirmPassword.length > 0 && !passwordsMatch ? (
          <p className="auth-message auth-message--error">Heslá sa nezhodujú.</p>
        ) : null}

        <button type="submit" disabled={!canSubmit}>
          {status.loading ? "Obnovujem..." : "Obnoviť heslo"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          Späť na <Link to="/login">prihlásenie</Link>
        </p>
      </form>
    </section>
  );
}

export default ResetPasswordPage;

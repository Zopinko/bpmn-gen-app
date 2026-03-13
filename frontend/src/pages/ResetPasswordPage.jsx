import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { resetPassword } from "../api/auth";

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get("token") || "").trim(), [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isStrongEnough = newPassword.length >= 8;
  const canSubmit = Boolean(token) && passwordsMatch && isStrongEnough && !status.loading;

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
        <label htmlFor="reset-new-password">Nové heslo</label>
        <input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          minLength={8}
          required
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
        {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}

        <p className="auth-footer">
          Späť na <Link to="/login">prihlásenie</Link>
        </p>
      </form>
    </section>
  );
}

export default ResetPasswordPage;

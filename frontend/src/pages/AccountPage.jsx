import { useState } from "react";
import { Link } from "react-router-dom";

import { changePassword } from "../api/auth";

function formatDate(value) {
  if (!value) return "Neznáme";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function AccountPage({ currentUser, onLogout }) {
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus({ loading: false, error: "Nové heslo a potvrdenie sa musia zhodovať.", success: "" });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ loading: false, error: "Nové heslo musí mať aspoň 8 znakov.", success: "" });
      return;
    }

    setStatus({ loading: true, error: "", success: "" });
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus({
        loading: false,
        error: "",
        success: "Heslo bolo úspešne zmenené.",
      });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.message || "Zmena hesla zlyhala.",
        success: "",
      });
    }
  };

  return (
    <section className="account-page">
      <div className="auth-card account-card">
        <div className="account-card-head">
          <div>
            <p className="auth-eyebrow">Účet</p>
            <h1>Profil</h1>
          </div>
          <div className="account-card-head__actions">
            <Link to="/" className="btn app-nav__link-btn">
              Späť
            </Link>
            <button type="button" className="btn app-nav__logout" onClick={onLogout}>
              Odhlásiť sa
            </button>
          </div>
        </div>
        <div className="account-info-grid">
          <div className="account-info-row">
            <span>E-mail</span>
            <strong>{currentUser?.email || "Neznáme"}</strong>
          </div>
          <div className="account-info-row">
            <span>User ID</span>
            <strong>{currentUser?.id || "Neznáme"}</strong>
          </div>
          <div className="account-info-row">
            <span>Organizácia</span>
            <strong>{currentUser?.org_name || "Neznáme"}</strong>
          </div>
          <div className="account-info-row">
            <span>Vytvorené</span>
            <strong>{formatDate(currentUser?.created_at)}</strong>
          </div>
        </div>
      </div>

      <section className="auth-card account-card">
        <button
          type="button"
          className={`account-section-toggle${isPasswordFormOpen ? " is-open" : ""}`}
          onClick={() => setIsPasswordFormOpen((prev) => !prev)}
          aria-expanded={isPasswordFormOpen}
        >
          <h1>Zmena hesla</h1>
          <span className="account-section-toggle__icon" aria-hidden="true" />
        </button>

        {isPasswordFormOpen ? (
          <form className="account-password-form" onSubmit={handleSubmit}>
            <label htmlFor="account-current-password">Aktuálne heslo</label>
            <input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />

            <label htmlFor="account-new-password">Nové heslo</label>
            <input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />

            <label htmlFor="account-confirm-password">Potvrď nové heslo</label>
            <input
              id="account-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />

            {confirmPassword.length > 0 && !passwordsMatch ? (
              <p className="auth-message auth-message--error">Nové heslo a potvrdenie sa musia zhodovať.</p>
            ) : null}

            <button type="submit" disabled={status.loading}>
              {status.loading ? "Mením..." : "Zmeniť heslo"}
            </button>

            {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
            {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}
          </form>
        ) : null}
      </section>
    </section>
  );
}

export default AccountPage;

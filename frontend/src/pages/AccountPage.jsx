import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n.js";

import { changePassword, updateMe } from "../api/auth";

function AccountPage({ currentUser, onLogout }) {
  const { t } = useTranslation();
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const [isLangFormOpen, setIsLangFormOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState(currentUser?.language || "sk");
  const [langStatus, setLangStatus] = useState({ loading: false, error: "", success: "" });

  const handleLangSave = async () => {
    setLangStatus({ loading: true, error: "", success: "" });
    try {
      await updateMe({ language: selectedLang });
      i18n.changeLanguage(selectedLang);
      setLangStatus({ loading: false, error: "", success: t("account.language_saved") });
    } catch (error) {
      setLangStatus({ loading: false, error: error?.message || t("account.error_generic"), success: "" });
    }
  };

  const formatDate = (value) => {
    if (!value) return t("account.unknown");
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  };

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus({ loading: false, error: t("account.passwords_mismatch"), success: "" });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ loading: false, error: t("account.password_too_short"), success: "" });
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
        success: t("account.password_changed"),
      });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.message || t("account.error_generic"),
        success: "",
      });
    }
  };

  return (
    <section className="account-page">
      <div className="auth-card account-card">
        <div className="account-card-head">
          <div>
            <p className="auth-eyebrow">{t("account.title")}</p>
            <h1>{t("account.profile")}</h1>
          </div>
          <div className="account-card-head__actions">
            <Link to="/" className="btn app-nav__link-btn">
              {t("account.back")}
            </Link>
            <button type="button" className="btn app-nav__logout" onClick={onLogout}>
              {t("account.logout")}
            </button>
          </div>
        </div>
        <div className="account-info-grid">
          <div className="account-info-row">
            <span>{t("account.field_email")}</span>
            <strong>{currentUser?.email || t("account.unknown")}</strong>
          </div>
          <div className="account-info-row">
            <span>{t("account.field_user_id")}</span>
            <strong>{currentUser?.id || t("account.unknown")}</strong>
          </div>
          <div className="account-info-row">
            <span>{t("account.field_org")}</span>
            <strong>{currentUser?.org_name || t("account.unknown")}</strong>
          </div>
          <div className="account-info-row">
            <span>{t("account.field_created")}</span>
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
          <h1>{t("account.change_password_title")}</h1>
          <span className="account-section-toggle__icon" aria-hidden="true" />
        </button>

        {isPasswordFormOpen ? (
          <form className="account-password-form" onSubmit={handleSubmit}>
            <label htmlFor="account-current-password">{t("account.current_password")}</label>
            <input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />

            <label htmlFor="account-new-password">{t("account.new_password")}</label>
            <input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />

            <label htmlFor="account-confirm-password">{t("account.confirm_password")}</label>
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
              <p className="auth-message auth-message--error">{t("account.passwords_mismatch")}</p>
            ) : null}

            <button type="submit" disabled={status.loading}>
              {status.loading ? t("account.submitting") : t("account.submit")}
            </button>

            {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
            {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="auth-card account-card">
        <button
          type="button"
          className={`account-section-toggle${isLangFormOpen ? " is-open" : ""}`}
          onClick={() => setIsLangFormOpen((prev) => !prev)}
          aria-expanded={isLangFormOpen}
        >
          <h1>{t("account.language_title")}</h1>
          <span className="account-section-toggle__icon" aria-hidden="true" />
        </button>

        {isLangFormOpen ? (
          <div className="account-lang-form">
            <div className="account-lang-grid" role="radiogroup" aria-label={t("account.language_title")}>
              <label className={`account-lang-option${selectedLang === "en" ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="lang"
                  value="en"
                  checked={selectedLang === "en"}
                  onChange={() => setSelectedLang("en")}
                />
                <span className="account-lang-option__content">
                  <span className="account-lang-option__title">{t("account.language_en")}</span>
                  <span className="account-lang-option__meta">EN</span>
                </span>
              </label>
              <label className={`account-lang-option${selectedLang === "sk" ? " is-selected" : ""}`}>
                <input
                  type="radio"
                  name="lang"
                  value="sk"
                  checked={selectedLang === "sk"}
                  onChange={() => setSelectedLang("sk")}
                />
                <span className="account-lang-option__content">
                  <span className="account-lang-option__title">{t("account.language_sk")}</span>
                  <span className="account-lang-option__meta">SK</span>
                </span>
              </label>
            </div>
            <div className="account-lang-actions">
              <div className="account-lang-hint">
                {selectedLang === "sk" ? t("account.language_sk") : t("account.language_en")}
              </div>
              <button type="button" className="btn" onClick={handleLangSave} disabled={langStatus.loading}>
                {langStatus.loading ? "..." : t("account.language_save")}
              </button>
            </div>
            {langStatus.error ? <p className="auth-message auth-message--error">{langStatus.error}</p> : null}
            {langStatus.success ? <p className="auth-message auth-message--success">{langStatus.success}</p> : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}

export default AccountPage;

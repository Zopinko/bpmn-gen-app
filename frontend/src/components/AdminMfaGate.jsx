import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { confirmAdminMfa, getAdminMfaStatus, setupAdminMfa, unlockAdminMfa } from "../api/admin";
import "../pages/AdminPanelPage.css";

export default function AdminMfaGate({ children }) {
  const { t } = useTranslation();
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      setState(await getAdminMfaStatus());
    } catch {
      setState(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state?.unlocked || !state.expires_at) return undefined;
    const timeout = window.setTimeout(() => {
      setState((current) => current ? { ...current, unlocked: false } : current);
    }, Math.max(0, Date.parse(state.expires_at) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setup) {
        const result = await confirmAdminMfa(input);
        setRecoveryCodes(result.recovery_codes);
        setSetup(null);
      } else if (state.enrolled) {
        await unlockAdminMfa(input);
        await refresh();
      } else {
        setSetup(await setupAdminMfa(input));
      }
    } catch (requestError) {
      if (requestError.status === 409) {
        setSetup(null);
        await refresh();
      }
      const code = requestError.status === 429 ? "rate_limit" : "error";
      setError(t(`admin.mfa.${code}`));
    } finally {
      setInput("");
      setBusy(false);
    }
  }

  if (state?.unlocked && recoveryCodes.length === 0) return children;

  const needsPassword = state && !state.enrolled && !setup;
  const inputLabel = needsPassword ? "password" : setup ? "authenticator_code" : "unlock_code";

  return (
    <section className="admin-monitor">
      <header className="admin-monitor__header">
        <h1>{t("admin.mfa.title")}</h1>
        <Link className="admin-monitor__back" to="/">{t("admin.mfa.back")}</Link>
      </header>
      <div className="admin-mfa">
        {recoveryCodes.length > 0 ? (
          <>
            <h2>{t("admin.mfa.recovery_title")}</h2>
            <p>{t("admin.mfa.recovery_message")}</p>
            <ul>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
            <button className="admin-monitor__back" type="button" onClick={() => {
              setRecoveryCodes([]);
              void refresh();
            }}>{t("admin.mfa.saved")}</button>
          </>
        ) : !state ? (
          failed ? (
            <>
              <p role="alert">{t("admin.mfa.unavailable")}</p>
              <button className="admin-monitor__back" type="button" onClick={refresh}>{t("admin.mfa.retry")}</button>
            </>
          ) : <p role="status">{t("admin.mfa.loading")}</p>
        ) : !state.email_verified ? (
          <p>
            {t("admin.mfa.verify_email")} <Link to="/account">{t("admin.mfa.account")}</Link>
          </p>
        ) : (
          <form onSubmit={submit}>
            {setup ? (
              <>
                <p>{t("admin.mfa.scan")}</p>
                <img src={setup.qr_data_url} width="192" height="192" alt={t("admin.mfa.qr_alt")} />
                <p>{t("admin.mfa.manual_key")} <code>{setup.manual_key}</code></p>
              </>
            ) : <p>{t(needsPassword ? "admin.mfa.setup_message" : "admin.mfa.unlock_message")}</p>}
            <label>
              {t(`admin.mfa.${inputLabel}`)}
              <input
                type={needsPassword ? "password" : "text"}
                autoComplete={needsPassword ? "current-password" : "one-time-code"}
                inputMode={setup ? "numeric" : undefined}
                maxLength={needsPassword ? 1024 : setup ? 6 : 64}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                required
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="admin-monitor__back" type="submit" disabled={busy}>
              {t(needsPassword ? "admin.mfa.setup" : "admin.mfa.confirm")}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendOrgInviteEmail } from "../api/wizard";

export default function OrganizationInviteEmailForm({ orgId }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [sentTo, setSentTo] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!orgId || status === "loading") return;
    const recipient = email.trim();
    setStatus("loading");
    try {
      await sendOrgInviteEmail(orgId, recipient);
      setSentTo(recipient);
      setEmail("");
      setStatus("queued");
    } catch (error) {
      setStatus(error.status === 429 ? "limited" : error.status === 503 ? "unavailable" : "error");
    }
  };

  return (
    <form className="organization-invite-panel" onSubmit={submit}>
      <label className="wizard-field" htmlFor="org-invite-email">
        <span>{t("org.invite_email_label")}</span>
        <input id="org-invite-email" type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={status === "loading"} required />
      </label>
      <p className="organization-hint">{t("org.invite_email_hint")}</p>
      <div className="organization-inline-actions">
        <button className="btn btn--small btn-primary" type="submit" disabled={status === "loading"}>
          {t(status === "loading" ? "org.invite_email_loading" : "org.invite_email_submit")}
        </button>
      </div>
      {status === "queued" ? <p className="auth-message auth-message--success" role="status">{t("org.invite_email_queued", { email: sentTo })}</p> : null}
      {["limited", "unavailable", "error"].includes(status) ? (
        <p className="auth-message auth-message--error" role="alert">{t(`org.invite_email_${status}`)}</p>
      ) : null}
    </form>
  );
}

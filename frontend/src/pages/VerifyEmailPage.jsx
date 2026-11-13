import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { confirmEmailVerification, resendEmailVerification } from "../api/auth";
import { orgInvitePath, PENDING_ORG_INVITE_KEY } from "../organizationInvite";

export default function VerifyEmailPage({ currentUser, onVerified }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  const [email, setEmail] = useState(location.state?.email || currentUser?.email || "");
  const [feedback, setFeedback] = useState({ token: null, status: "idle" });
  const status = token && token !== feedback.token ? "idle" : feedback.status;
  const setStatus = (nextStatus) => setFeedback({ token, status: nextStatus });
  const canConfirm = Boolean(token);
  const confirmed = status === "confirmed";
  const pendingInvite = confirmed && currentUser ? window.localStorage.getItem(PENDING_ORG_INVITE_KEY) : null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    try {
      if (canConfirm) {
        await confirmEmailVerification(token);
        setStatus("confirmed");
        navigate("/verify-email", { replace: true });
        if (currentUser) void onVerified();
      } else {
        await resendEmailVerification(email);
        setStatus("requested");
      }
    } catch (error) {
      setStatus(canConfirm && error.status === 400 ? "invalid" : error.status === 429 ? "rate_limit" : "error");
      if (canConfirm && error.status === 400) navigate("/verify-email", { replace: true });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>{t("email_verification.title")}</h1>
        {!confirmed && status !== "invalid" ? (
          <p className="auth-intro">
            {t(canConfirm ? "email_verification.confirm_intro" : location.state?.justRegistered ? "email_verification.registered" : "email_verification.resend_intro")}
          </p>
        ) : null}

        {!confirmed && !canConfirm ? (
          <>
            <label htmlFor="verification-email">{t("email_verification.email")}</label>
            <input id="verification-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </>
        ) : null}
        {!confirmed ? (
          <button type="submit" disabled={status === "loading"}>
            {t(status === "loading" ? "email_verification.loading" : canConfirm ? "email_verification.confirm" : "email_verification.resend")}
          </button>
        ) : null}
        {confirmed || status === "requested" ? (
          <p className="auth-message auth-message--success" role="status">{t(`email_verification.${status}`)}</p>
        ) : null}
        {["invalid", "rate_limit", "error"].includes(status) ? (
          <p className="auth-message auth-message--error" role="alert">{t(`email_verification.${status}`)}</p>
        ) : null}
        <p className="auth-footer">
          <Link to={pendingInvite ? orgInvitePath(pendingInvite) : currentUser ? "/account" : "/login"}>
            {t(pendingInvite ? "join_org.resume_invite" : currentUser ? "email_verification.back_to_account" : "email_verification.back_to_login")}
          </Link>
        </p>
      </form>
    </section>
  );
}

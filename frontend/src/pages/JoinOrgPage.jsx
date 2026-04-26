import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { acceptOrgInvite } from "../api/wizard";

const PENDING_INVITE_STORAGE_KEY = "PENDING_ORG_INVITE_TOKEN";

function mapInviteErrorMessage(rawMessage, t) {
  const message = String(rawMessage || "").toLowerCase();
  if (message.includes("vypršal")) {
    return t("join_org.error_expired");
  }
  if (message.includes("zrušen")) {
    return t("join_org.error_revoked");
  }
  if (message.includes("použit")) {
    return t("join_org.error_used");
  }
  if (message.includes("neplat")) {
    return t("join_org.error_invalid");
  }
  return t("join_org.error_generic");
}

function JoinOrgPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useParams();
  const [status, setStatus] = useState({ loading: true, error: "", message: "" });

  useEffect(() => {
    let isCancelled = false;
    const run = async () => {
      if (!token) {
        setStatus({ loading: false, error: t("join_org.error_invalid"), message: "" });
        return;
      }
      setStatus({ loading: true, error: "", message: "" });
      try {
        const response = await acceptOrgInvite(token);
        if (isCancelled) return;
        const org = response?.org || {};
        if (typeof window !== "undefined") {
          if (org?.id) window.localStorage.setItem("ACTIVE_ORG_ID", org.id);
          if (org?.name) window.localStorage.setItem("ACTIVE_ORG_NAME", org.name);
          window.localStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
          window.dispatchEvent(new Event("active-org-changed"));
        }
        const alreadyMember = Boolean(response?.membership?.already_member);
        const orgName = org?.name || org?.id || "";
        setStatus({
          loading: false,
          error: "",
          message: alreadyMember
            ? t("join_org.already_member", { name: orgName })
            : t("join_org.success", { name: orgName }),
        });
        window.setTimeout(() => {
          navigate("/", { replace: true });
        }, 1100);
      } catch (error) {
        if (isCancelled) return;
        if (error?.status === 401) {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(PENDING_INVITE_STORAGE_KEY, token);
          }
          navigate("/login", { replace: true });
          return;
        }
        setStatus({
          loading: false,
          error: mapInviteErrorMessage(error?.message, t),
          message: "",
        });
      }
    };
    void run();
    return () => {
      isCancelled = true;
    };
  }, [navigate, token, t]);

  return (
    <section className="auth-page">
      <div className="auth-card">
        <h1>{t("join_org.title")}</h1>
        {status.loading ? <p>{t("join_org.loading")}</p> : null}
        {status.message ? <p className="auth-message auth-message--success">{status.message}</p> : null}
        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {!status.loading ? (
          <p className="auth-footer">
            <Link to="/">{t("join_org.back")}</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default JoinOrgPage;

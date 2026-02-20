import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { acceptOrgInvite } from "../api/wizard";

const PENDING_INVITE_STORAGE_KEY = "PENDING_ORG_INVITE_TOKEN";

function JoinOrgPage() {
  const navigate = useNavigate();
  const { token } = useParams();
  const [status, setStatus] = useState({ loading: true, error: "", message: "" });

  useEffect(() => {
    let isCancelled = false;
    const run = async () => {
      if (!token) {
        setStatus({ loading: false, error: "Neplatný invite link.", message: "" });
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
        setStatus({
          loading: false,
          error: "",
          message: `Organizácia ${org?.name || org?.id || ""} bola úspešne pripojená.`,
        });
        window.setTimeout(() => {
          navigate("/", { replace: true });
        }, 900);
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
          error: error?.message || "Nepodarilo sa prijať invite link.",
          message: "",
        });
      }
    };
    void run();
    return () => {
      isCancelled = true;
    };
  }, [navigate, token]);

  return (
    <section className="auth-page">
      <div className="auth-card">
        <h1>Pridanie do organizácie</h1>
        {status.loading ? <p>Spracúvam invite link...</p> : null}
        {status.message ? <p className="auth-message auth-message--success">{status.message}</p> : null}
        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {!status.loading ? (
          <p className="auth-footer">
            <Link to="/">Späť do aplikácie</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default JoinOrgPage;

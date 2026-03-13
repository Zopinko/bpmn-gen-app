import { useState } from "react";
import { Link } from "react-router-dom";

import { requestPasswordReset } from "../api/auth";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "", success: "" });
    try {
      await requestPasswordReset({ email });
      setStatus({
        loading: false,
        error: "",
        success: "Ak účet s týmto emailom existuje, poslali sme odkaz na reset hesla.",
      });
    } catch {
      setStatus({
        loading: false,
        error: "Požiadavka zlyhala. Skús to znova.",
        success: "",
      });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Zabudnuté heslo</h1>
        <label htmlFor="forgot-password-email">Email</label>
        <input
          id="forgot-password-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Odosielam..." : "Poslať reset link"}
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

export default ForgotPasswordPage;

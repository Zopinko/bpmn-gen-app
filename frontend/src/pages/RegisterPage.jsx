import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { trackSignupCompleted } from "../api/analytics";
import { registerAuth } from "../api/auth";

function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setStatus({ loading: false, error: "Heslá sa nezhodujú.", success: "" });
      return;
    }
    setStatus({ loading: true, error: "", success: "" });
    try {
      const result = await registerAuth({ email, password });
      const sid = new URLSearchParams(location.search).get("sid");
      void trackSignupCompleted(sid || undefined);
      setStatus({ loading: false, error: "", success: result?.message || "Registrácia bola úspešná." });
      setTimeout(() => navigate("/login"), 800);
    } catch (error) {
      setStatus({ loading: false, error: error.message, success: "" });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="auth-eyebrow">BPMN.GEN</p>
        <h1>Registrácia</h1>
        <p className="auth-intro">
          Vytvor si účet a priprav si priestor pre vlastné procesy, tím a organizáciu.
        </p>

        <label htmlFor="register-email">E-mail</label>
        <input
          id="register-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="register-password">Heslo</label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />

        <label htmlFor="register-confirm-password">Potvrď heslo</label>
        <input
          id="register-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={8}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Registrujem..." : "Vytvoriť účet"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}

        <p className="auth-footer">
          Už máš účet? <Link to="/login">Prihlás sa</Link>
        </p>
      </form>
    </section>
  );
}

export default RegisterPage;

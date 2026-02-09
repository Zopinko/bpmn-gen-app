import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { registerAuth } from "../api/auth";

function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setStatus({ loading: false, error: "Hesla sa nezhoduju.", success: "" });
      return;
    }
    setStatus({ loading: true, error: "", success: "" });
    try {
      const result = await registerAuth({ email, password });
      setStatus({ loading: false, error: "", success: result?.message || "Registracia bola uspesna." });
      setTimeout(() => navigate("/login"), 800);
    } catch (error) {
      setStatus({ loading: false, error: error.message, success: "" });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Registracia</h1>
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="register-password">Heslo</label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />

        <label htmlFor="register-confirm-password">Potvrd heslo</label>
        <input
          id="register-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={8}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Registrujem..." : "Vytvorit ucet"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}
        {status.success ? <p className="auth-message auth-message--success">{status.success}</p> : null}

        <p className="auth-footer">
          Uz mas ucet? <Link to="/login">Prihlas sa</Link>
        </p>
      </form>
    </section>
  );
}

export default RegisterPage;

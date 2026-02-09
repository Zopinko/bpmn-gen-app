import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getMe, loginAuth } from "../api/auth";

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "" });

  useEffect(() => {
    let mounted = true;
    getMe()
      .then(() => {
        if (mounted) navigate("/", { replace: true });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "" });
    try {
      await loginAuth({ email, password });
      navigate("/", { replace: true });
    } catch (error) {
      setStatus({ loading: false, error: error.message });
    }
  };

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Prihlasenie</h1>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="login-password">Heslo</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <button type="submit" disabled={status.loading}>
          {status.loading ? "Prihlasujem..." : "Prihlasit sa"}
        </button>

        {status.error ? <p className="auth-message auth-message--error">{status.error}</p> : null}

        <p className="auth-footer">
          Nemas ucet? <Link to="/register">Zaregistruj sa</Link>
        </p>
      </form>
    </section>
  );
}

export default LoginPage;

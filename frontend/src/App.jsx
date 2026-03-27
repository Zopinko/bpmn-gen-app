import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import HeaderStepper from "./components/HeaderStepper";
import { HeaderStepperProvider } from "./components/HeaderStepperContext";
import { getMe, logoutAuth } from "./api/auth";
import LinearWizardPage from "./pages/LinearWizardPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AccountPage from "./pages/AccountPage";
import OrganizationPage from "./pages/OrganizationPage";
import JoinOrgPage from "./pages/JoinOrgPage";
import AdminPanelPage from "./pages/AdminPanelPage";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <HeaderStepperProvider>
        <AppLayout />
      </HeaderStepperProvider>
    </BrowserRouter>
  );
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authState, setAuthState] = useState({ user: null, loading: true });
  const [activeOrgLabel, setActiveOrgLabel] = useState("");
  const isDemoRoute = location.pathname === "/demo";

  const refreshAuthState = useCallback(async () => {
    setAuthState((prev) => ({ ...prev, loading: true }));
    try {
      const result = await getMe();
      setAuthState({ user: result?.user || null, loading: false });
      return result?.user || null;
    } catch {
      setAuthState({ user: null, loading: false });
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshAuthState();
  }, [refreshAuthState]);

  const handleLogout = async () => {
    if (typeof window !== "undefined" && window.__FLOWMATE_REQUEST_SAVE__) {
      const shouldProceed = await window.__FLOWMATE_REQUEST_SAVE__();
      if (!shouldProceed) {
        return;
      }
    }
    try {
      await logoutAuth();
      await refreshAuthState();
    } finally {
      setAuthState({ user: null, loading: false });
      setActiveOrgLabel("");
      navigate("/login", { replace: true });
    }
  };

  useEffect(() => {
    const readActiveOrg = () => {
      if (typeof window === "undefined") return;
      const id = window.localStorage.getItem("ACTIVE_ORG_ID") || "";
      const name = window.localStorage.getItem("ACTIVE_ORG_NAME") || "";
      if (!id && !name) {
        setActiveOrgLabel("");
        return;
      }
      setActiveOrgLabel(name || id);
    };
    readActiveOrg();
    if (typeof window === "undefined") return;
    const handler = () => readActiveOrg();
    window.addEventListener("active-org-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("active-org-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [authState.user]);


  const renderProtected = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">Načítavam workspace...</div>;
    }
    if (!authState.user) {
      return <Navigate to="/login" replace />;
    }
    return element;
  };

  const renderPublicOnly = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">Načítavam workspace...</div>;
    }
    if (authState.user) {
      return <Navigate to="/" replace />;
    }
    return element;
  };

  const renderSuperAdminOnly = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">Načítavam workspace...</div>;
    }
    if (!authState.user) {
      return <Navigate to="/login" replace />;
    }
    if (authState.user?.admin_panel_available !== true || authState.user?.is_super_admin !== true) {
      return <Navigate to="/" replace />;
    }
    return element;
  };

  return (
      <div className="app-shell">
        <header className="app-nav">
            <div className="app-nav__left">
            <Link to="/" className="app-nav__brand" aria-label="Prejsť na hlavné menu">
              <span className="app-nav__brand-text">BPMN.Gen</span>
            </Link>
          <HeaderStepper />
          </div>
          <nav className="app-nav__links">
            {isDemoRoute ? (
              <div className="app-nav__auth">
                <button
                  type="button"
                  className="btn app-nav__logout"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new Event("demo-info-requested"));
                    }
                  }}
                >
                  Demo info
                </button>
                <button
                  type="button"
                  className="btn app-nav__logout"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new Event("demo-reset-requested"));
                    }
                  }}
                >
                  Reset demo
                </button>
                <Link to="/register" className="app-nav__link">
                  Create account
                </Link>
              </div>
            ) : !authState.user ? (
              <>
                <Link to="/login" className="app-nav__link">
                  Prihlásenie
                </Link>
                <Link to="/register" className="app-nav__link">
                  Registrácia
                </Link>
              </>
            ) : (
              <div className="app-nav__auth">
                {!authState.loading &&
                authState.user?.admin_panel_available === true &&
                authState.user?.is_super_admin === true ? (
                  <Link to="/admin" className="app-nav__link">
                    Admin
                  </Link>
                ) : null}
                <div className="app-nav__auth-meta">
                  <span className="app-nav__auth-status">Prihlásený: {authState.user.email}</span>
                  {activeOrgLabel ? (
                    <span className="app-nav__auth-status">Aktívna organizácia: {activeOrgLabel}</span>
                  ) : (
                    <span className="app-nav__auth-status">Zatiaľ nemáš aktívnu organizáciu</span>
                  )}
                </div>
                <Link to="/organization" className="btn app-nav__profile">
                  Organizácia
                </Link>
                <Link to="/account" className="btn app-nav__profile">
                  Profil
                </Link>
              </div>
            )}
          </nav>
        </header>
        <main className="app-shell__body">
          <Routes>
            <Route path="/" element={renderProtected(<LinearWizardPage currentUser={authState.user} />)} />
            <Route path="/demo" element={<LinearWizardPage isDemo />} />
            <Route path="/admin" element={renderSuperAdminOnly(<AdminPanelPage />)} />
            <Route
              path="/account"
              element={renderProtected(<AccountPage currentUser={authState.user} onLogout={handleLogout} />)}
            />
            <Route path="/organization" element={renderProtected(<OrganizationPage />)} />
            <Route path="/model/:modelId" element={renderProtected(<LinearWizardPage currentUser={authState.user} />)} />
            <Route path="/karta-procesu" element={renderProtected(<Navigate to="/" replace />)} />
            <Route
              path="/login"
              element={renderPublicOnly(<LoginPage onLoginSuccess={refreshAuthState} />)}
            />
            <Route path="/register" element={renderPublicOnly(<RegisterPage />)} />
            <Route path="/forgot-password" element={renderPublicOnly(<ForgotPasswordPage />)} />
            <Route path="/reset-password" element={renderPublicOnly(<ResetPasswordPage />)} />
            <Route path="/join-org/:token" element={<JoinOrgPage />} />
            <Route path="/wizard/linear" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
  );
}

export default App;




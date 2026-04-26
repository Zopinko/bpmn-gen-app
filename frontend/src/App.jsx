import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "./i18n.js";
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
  const isDemoRoute = location.pathname === "/demo";
  const showHeader =
    isDemoRoute ||
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password" ||
    location.pathname.startsWith("/join-org/");
  const { t } = useTranslation();

  const refreshAuthState = useCallback(async () => {
    setAuthState((prev) => ({ ...prev, loading: true }));
    try {
      const result = await getMe();
      const user = result?.user || null;
      if (user?.language) {
        i18n.changeLanguage(user.language);
      }
      setAuthState({ user, loading: false });
      return user;
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
      navigate("/login", { replace: true });
    }
  };


  const renderProtected = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">{t("app.loading")}</div>;
    }
    if (!authState.user) {
      return <Navigate to="/login" replace />;
    }
    return element;
  };

  const renderPublicOnly = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">{t("app.loading")}</div>;
    }
    if (authState.user) {
      return <Navigate to="/" replace />;
    }
    return element;
  };

  const renderSuperAdminOnly = (element) => {
    if (authState.loading) {
      return <div className="app-shell-loading">{t("app.loading")}</div>;
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
      <div className={`app-shell ${showHeader ? "" : "app-shell--headerless"}`.trim()}>
        {showHeader ? (
        <header className="app-nav">
            <div className="app-nav__left">
            <Link to="/" className="app-nav__brand" aria-label={t("app.brand_label")}>
              <span className="app-nav__brand-text">BPMN.Gen</span>
            </Link>
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
                  {t("app.nav.demo_info")}
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
                  {t("app.nav.demo_reset")}
                </button>
                <Link to="/register" className="app-nav__link">
                  {t("app.nav.create_account")}
                </Link>
              </div>
            ) : !authState.user ? (
              <>
                <Link to="/login" className="app-nav__link">
                  {t("app.nav.login")}
                </Link>
                <Link to="/register" className="app-nav__link">
                  {t("app.nav.register")}
                </Link>
              </>
            ) : (
              <div className="app-nav__auth" />
            )}
          </nav>
        </header>
        ) : null}
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

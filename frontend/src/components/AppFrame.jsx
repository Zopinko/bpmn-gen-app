import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import WorkspaceIcon from "./WorkspaceIcon";

/**
 * Shared workspace chrome (top bar + icon rail) for the secondary pages,
 * so Organization / Substitutability / Profile / Admin match the map workspace.
 */
export default function AppFrame({ currentUser, title, children }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isAdmin = currentUser?.admin_panel_available === true && currentUser?.is_super_admin === true;

  const navItems = [
    { to: "/", icon: "home", label: t("workspace.home") },
    { to: "/organization", icon: "organization", label: t("app.nav.organization") },
    { to: "/workforce", icon: "workforce", label: t("workspace.workforce") },
  ];

  const railLink = (item) => {
    const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        className={`ws-rail__btn ${active ? "is-active" : ""}`}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        <WorkspaceIcon name={item.icon} />
      </Link>
    );
  };

  return (
    <div className="ws-shell ws-frame">
      <header className="ws-topbar">
        <Link to="/" className="ws-topbar__brand" aria-label={t("app.brand_label")}>
          <span className="ws-topbar__logo" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
        </Link>
        <h1 className="ws-frame__title">{title}</h1>
        <div className="ws-topbar__process">
          {currentUser?.email ? <span className="ws-topbar__meta">{currentUser.email}</span> : null}
        </div>
      </header>
      <div className="ws-frame__body">
        <nav className="ws-rail" aria-label={t("workspace.rail_label")}>
          {railLink(navItems[0])}
          <span className="ws-rail__sep" aria-hidden="true" />
          {navItems.slice(1).map(railLink)}
          <span className="ws-rail__spacer" />
          {isAdmin ? railLink({ to: "/admin", icon: "admin", label: t("app.nav.admin") }) : null}
          {currentUser ? (
            <Link
              to="/account"
              className={`ws-rail__avatar ${pathname.startsWith("/account") ? "is-active" : ""}`}
              title={`${t("app.nav.profile")} · ${currentUser.email}`}
              aria-label={t("app.nav.profile")}
              aria-current={pathname.startsWith("/account") ? "page" : undefined}
            >
              {(currentUser.email || "?").slice(0, 2).toUpperCase()}
            </Link>
          ) : null}
        </nav>
        <div className="ws-frame__content">{children}</div>
      </div>
    </div>
  );
}

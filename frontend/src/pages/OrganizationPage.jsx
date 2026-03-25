import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  addOrgMember,
  createOrg,
  getOrgInviteLink,
  listMyOrgs,
  listOrgActivity,
  listOrgMembers,
  removeOrgMember,
  updateOrgMemberRole,
} from "../api/wizard";
import { getOrgCapabilities, getOrgRoleLabel, normalizeOrgRole } from "../permissions/orgCapabilities";

function OrganizationPage() {
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [addMemberError, setAddMemberError] = useState("");
  const [addMemberInfo, setAddMemberInfo] = useState("");

  const [inviteLink, setInviteLink] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteMeta, setInviteMeta] = useState(null);
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");

  const [newOrgName, setNewOrgName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createInfo, setCreateInfo] = useState("");
  const [memberActionModal, setMemberActionModal] = useState({
    open: false,
    action: "",
    targetEmail: "",
    targetRole: "",
    typedEmail: "",
    loading: false,
    error: "",
  });

  const applyActiveOrg = useCallback((allOrgs, preferredId) => {
    const safeOrgs = Array.isArray(allOrgs) ? allOrgs : [];
    if (!safeOrgs.length) {
      setActiveOrgId("");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("ACTIVE_ORG_ID");
        window.localStorage.removeItem("ACTIVE_ORG_NAME");
        window.dispatchEvent(new Event("active-org-changed"));
      }
      return;
    }

    const preferred = preferredId ? safeOrgs.find((org) => String(org.id) === String(preferredId)) : null;
    const fromStorage =
      typeof window !== "undefined"
        ? safeOrgs.find((org) => String(org.id) === String(window.localStorage.getItem("ACTIVE_ORG_ID") || ""))
        : null;
    const active = preferred || fromStorage || safeOrgs[0];
    const nextId = String(active?.id || "");
    const nextName = String(active?.name || "");
    setActiveOrgId(nextId);
    if (typeof window !== "undefined" && nextId) {
      window.localStorage.setItem("ACTIVE_ORG_ID", nextId);
      window.localStorage.setItem("ACTIVE_ORG_NAME", nextName);
      window.dispatchEvent(new Event("active-org-changed"));
    }
  }, []);

  const refreshOrgs = useCallback(
    async (preferredId = "") => {
      setLoading(true);
      setError("");
      try {
        const items = await listMyOrgs();
        setOrgs(items || []);
        applyActiveOrg(items || [], preferredId);
      } catch (e) {
        setError(e?.message || "Nepodarilo sa načítať organizácie.");
        setOrgs([]);
      } finally {
        setLoading(false);
      }
    },
    [applyActiveOrg],
  );

  const activeOrg = useMemo(
    () => orgs.find((org) => String(org.id) === String(activeOrgId)) || null,
    [orgs, activeOrgId],
  );
  const ownsAnyOrg = useMemo(
    () => orgs.some((org) => normalizeOrgRole(org?.role) === "owner"),
    [orgs],
  );
  const ownedOrganizations = useMemo(
    () => orgs.filter((org) => normalizeOrgRole(org?.role) === "owner"),
    [orgs],
  );
  const joinedOrganizations = useMemo(
    () => orgs.filter((org) => normalizeOrgRole(org?.role) !== "owner"),
    [orgs],
  );
  const activeOrgCapabilities = useMemo(() => getOrgCapabilities(activeOrg?.role), [activeOrg?.role]);
  const inviteStatus = String(inviteMeta?.status || "missing").toLowerCase();

  const formatDateTime = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("sk-SK");
  };

  const inviteStatusLabel = (status) => {
    if (status === "active") return "Aktívna";
    if (status === "expired") return "Vypršaná";
    if (status === "revoked") return "Zrušená";
    if (status === "used") return "Použitá";
    return "Nevytvorená";
  };

  const inviteStatusHint = (status) => {
    if (status === "active") {
      return inviteMeta?.expires_at
        ? `Pozvánka je aktívna do ${formatDateTime(inviteMeta.expires_at)}.`
        : "Pozvánka je aktívna.";
    }
    if (status === "expired") return "Táto pozvánka už vypršala. Vygeneruj novú.";
    if (status === "revoked") return "Táto pozvánka bola zrušená po vygenerovaní novšej pozvánky.";
    if (status === "used") return "Táto pozvánka už bola použitá a nie je možné ju použiť znovu.";
    return "Zatiaľ nemáš vytvorenú žiadnu pozvánku.";
  };

  const refreshMembers = useCallback(async () => {
    if (!activeOrgId) {
      setMembers([]);
      setMembersError("");
      return;
    }
    setMembersLoading(true);
    setMembersError("");
    try {
      const items = await listOrgMembers(activeOrgId);
      setMembers(items || []);
    } catch (e) {
      setMembersError(e?.message || "Nepodarilo sa načítať členov.");
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [activeOrgId]);

  const refreshInviteStatus = useCallback(async () => {
    if (!activeOrgId || !activeOrgCapabilities.canManageInvites) {
      setInviteMeta(null);
      setInviteLink("");
      return;
    }
    setInviteLoading(true);
    setInviteError("");
    try {
      const response = await getOrgInviteLink(activeOrgId, { createIfMissing: false });
      setInviteMeta(response || { status: "missing" });
      if (response?.token) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setInviteLink(`${origin}/join-org/${response.token}`);
      } else {
        setInviteLink("");
      }
    } catch (e) {
      setInviteMeta(null);
      setInviteLink("");
      setInviteError(e?.message || "Nepodarilo sa načítať stav pozvánky.");
    } finally {
      setInviteLoading(false);
    }
  }, [activeOrgCapabilities.canManageInvites, activeOrgId]);

  const refreshActivity = useCallback(async () => {
    if (!activeOrgId) {
      setActivityItems([]);
      setActivityError("");
      return;
    }
    setActivityLoading(true);
    setActivityError("");
    try {
      const response = await listOrgActivity(activeOrgId, 25);
      setActivityItems(Array.isArray(response?.items) ? response.items : []);
    } catch (e) {
      setActivityItems([]);
      setActivityError(e?.message || "Nepodarilo sa nacitat aktivitu.");
    } finally {
      setActivityLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void refreshOrgs();
  }, [refreshOrgs]);

  useEffect(() => {
    setInviteLink("");
    setInviteMeta(null);
    setInviteError("");
    setInviteCopied(false);
    setAddMemberError("");
    setAddMemberInfo("");
    setAddMemberEmail("");
    void refreshMembers();
  }, [activeOrgId, refreshMembers]);

  useEffect(() => {
    void refreshInviteStatus();
  }, [refreshInviteStatus]);

  useEffect(() => {
    void refreshActivity();
  }, [refreshActivity]);

  const handleSelectActiveOrg = (org) => {
    if (!org?.id) return;
    applyActiveOrg(orgs, org.id);
  };

  const handleCreateOrg = async (event) => {
    event.preventDefault();
    const trimmed = newOrgName.trim();
    if (!trimmed) return;
    setCreateLoading(true);
    setCreateError("");
    setCreateInfo("");
    try {
      const created = await createOrg(trimmed);
      setCreateInfo("Organizacia bola vytvorena.");
      setNewOrgName("");
      await refreshOrgs(created?.id || "");
    } catch (e) {
      setCreateError(e?.message || "Nepodarilo sa vytvoriť organizáciu.");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleAddMember = async (event) => {
    event.preventDefault();
    if (!activeOrgId || !addMemberEmail.trim()) return;
    setAddMemberLoading(true);
    setAddMemberError("");
    setAddMemberInfo("");
    try {
      const response = await addOrgMember(addMemberEmail.trim(), activeOrgId, "member");
      if (response?.already_member) {
        setAddMemberInfo("Používateľ už je členom organizácie.");
      } else {
        setAddMemberInfo("Používateľ bol pridaný do organizácie.");
      }
      setAddMemberEmail("");
      await refreshMembers();
    } catch (e) {
      setAddMemberError(e?.message || "Nepodarilo sa pridať člena.");
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleGetInviteLink = async (regenerate = false) => {
    if (!activeOrgId) {
      setInviteError("Najprv vyber aktívnu organizáciu.");
      return;
    }
    setInviteLoading(true);
    setInviteError("");
    setInviteCopied(false);
    try {
      const response = await getOrgInviteLink(activeOrgId, { regenerate });
      setInviteMeta(response || null);
      const token = response?.token || "";
      if (!token) {
        setInviteLink("");
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(`${origin}/join-org/${token}`);
    } catch (e) {
      setInviteMeta(null);
      setInviteError(e?.message || "Nepodarilo sa získať invite link.");
      setInviteLink("");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = inviteLink;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setInviteCopied(true);
    } catch {
      setInviteError("Kopírovanie zlyhalo.");
    }
  };

  const openMemberActionModal = (action, email, role = "") => {
    setMemberActionModal({
      open: true,
      action,
      targetEmail: email || "",
      targetRole: normalizeOrgRole(role),
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const closeMemberActionModal = () => {
    if (memberActionModal.loading) return;
    setMemberActionModal({
      open: false,
      action: "",
      targetEmail: "",
      targetRole: "",
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const handleConfirmMemberAction = async () => {
    const targetEmail = String(memberActionModal.targetEmail || "").trim().toLowerCase();
    const typedEmail = String(memberActionModal.typedEmail || "").trim().toLowerCase();
    const action = String(memberActionModal.action || "");
    if (!targetEmail || !typedEmail || typedEmail !== targetEmail) {
      setMemberActionModal((prev) => ({ ...prev, error: "Pre potvrdenie prepíš presnú emailovú adresu." }));
      return;
    }
    if (!activeOrgId) {
      setMemberActionModal((prev) => ({ ...prev, error: "Najprv vyber aktívnu organizáciu." }));
      return;
    }
    setMemberActionModal((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      if (action === "promote") {
        await updateOrgMemberRole(targetEmail, activeOrgId, "owner");
        setAddMemberInfo(`Používateľ ${targetEmail} bol povýšený na ownera.`);
      } else if (action === "demote") {
        await updateOrgMemberRole(targetEmail, activeOrgId, "member");
        setAddMemberInfo(`Používateľ ${targetEmail} bol zmenený na člena.`);
      } else {
        await removeOrgMember(targetEmail, activeOrgId);
        setAddMemberInfo(`Používateľ ${targetEmail} bol odstránený z organizácie.`);
      }
      await refreshOrgs(activeOrgId);
      await refreshMembers();
      closeMemberActionModal();
    } catch (e) {
      setMemberActionModal((prev) => ({ ...prev, loading: false, error: e?.message || "Zmena člena zlyhala." }));
    }
  };

  const describeActivity = (item) => {
    const actor = item?.actor_email || "Neznamy pouzivatel";
    const name = item?.entity_name || item?.entity_id || "polozka";
    const type = String(item?.event_type || "").toLowerCase();
    if (type === "process_created") return `${actor} vytvoril proces "${name}".`;
    if (type === "process_renamed") return `${actor} premenoval proces na "${name}".`;
    if (type === "process_moved") return `${actor} presunul proces "${name}".`;
    if (type === "process_deleted") return `${actor} odstranil proces "${name}".`;
    if (type === "model_pushed_to_org") return `${actor} pushol model "${name}" do organizacie.`;
    if (type === "member_added") return `${actor} pridal clena "${name}".`;
    if (type === "member_removed") return `${actor} odstranil clena "${name}".`;
    if (type === "member_role_updated") return `${actor} zmenil rolu clena "${name}".`;
    if (type === "invite_link_created") return `${actor} vytvoril invite link.`;
    if (type === "invite_link_regenerated") return `${actor} regeneroval invite link.`;
    if (type === "delete_requested") return `${actor} poziadal o odstranenie procesu "${name}".`;
    if (type === "delete_request_approved") return `${actor} schvalil odstranenie procesu "${name}".`;
    if (type === "delete_request_rejected") return `${actor} zamietol odstranenie procesu "${name}".`;
    return `${actor} vykonal akciu "${type || "unknown"}".`;
  };

  const resolvedDeleteRequestIds = useMemo(() => {
    const ids = new Set();
    activityItems.forEach((item) => {
      const type = String(item?.event_type || "").toLowerCase();
      const requestId = item?.metadata?.request_id;
      if ((type === "delete_request_approved" || type === "delete_request_rejected") && requestId) {
        ids.add(String(requestId));
      }
    });
    return ids;
  }, [activityItems]);

  const pendingDeleteRequestCount = useMemo(
    () =>
      activityItems.filter((item) => {
        const type = String(item?.event_type || "").toLowerCase();
        return type === "delete_requested" && item?.id && !resolvedDeleteRequestIds.has(String(item.id));
      }).length,
    [activityItems, resolvedDeleteRequestIds],
  );
  const memberCount = members.length;
  const activeOrgStatusLabel = activeOrgCapabilities.canManageMembers ? "Owner workspace" : "Clensky workspace";

  const getMemberActionMeta = () => {
    const action = String(memberActionModal.action || "");
    if (action === "promote") {
      return {
        title: "Potvrdenie povysenia na ownera",
        hint: "Pre potvrdenie povysenia prepíš presný email používateľa:",
        submitLabel: memberActionModal.loading ? "Povysujem..." : "Povysit na ownera",
        submitClass: "btn btn-primary",
      };
    }
    if (action === "demote") {
      return {
        title: "Potvrdenie zmeny na clena",
        hint: "Pre potvrdenie zmeny roly prepíš presný email používateľa:",
        submitLabel: memberActionModal.loading ? "Menim rolu..." : "Zmenit na clena",
        submitClass: "btn btn-danger",
      };
    }
    return {
      title: "Potvrdenie vyhodenia clena",
      hint: "Pre potvrdenie odstránenia člena prepíš presný email:",
      submitLabel: memberActionModal.loading ? "Odstraňujem..." : "Vyhodit z organizacie",
      submitClass: "btn btn-danger",
    };
  };

  return (
    <section className="organization-page">
      <div className="auth-card organization-card organization-hero">
        <div className="account-card-head">
          <div>
            <h1>Organizácie</h1>
            <p className="organization-intro">Tu spravuješ aktívnu organizáciu, členov, pozvánky a tímovú aktivitu.</p>
          </div>
          <div className="account-card-head__actions">
            <Link to="/" className="btn app-nav__link-btn">
              Späť
            </Link>
          </div>
        </div>
        {loading ? <p className="organization-hint">Načítavam organizácie...</p> : null}
        {error ? <p className="auth-message auth-message--error">{error}</p> : null}
      </div>

      <div className="auth-card organization-card organization-summary-card">
        <div className="organization-summary-head">
          <div className="organization-summary-head__copy">
            <div className="organization-section-head">
              <h2>Aktívna organizácia</h2>
              <span className="organization-active-badge">Aktívna</span>
            </div>
            <div className="organization-summary-title-row">
              <h3>{activeOrg?.name || "Nezvolená organizácia"}</h3>
              <span className="organization-summary-role">{getOrgRoleLabel(activeOrg?.role) || "-"}</span>
            </div>
            <p className="organization-hint">
              {!loading && !orgs.length
                ? "Zatiaľ nemáš žiadnu organizáciu. Nižšie si môžeš vytvoriť svoju prvú."
                : "Rýchly prehľad tímu, rolí a otvorených požiadaviek v aktívnej organizácii."}
            </p>
          </div>
          <div className="organization-summary-status">{activeOrgStatusLabel}</div>
        </div>
        {!loading && orgs.length ? (
          <div className="organization-summary-grid">
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">Moja rola</span>
              <strong className="organization-summary-stat__value">{getOrgRoleLabel(activeOrg?.role)}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">Členovia</span>
              <strong className="organization-summary-stat__value">{memberCount}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">Čakajúce požiadavky</span>
              <strong className="organization-summary-stat__value">{pendingDeleteRequestCount}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">Moje organizácie</span>
              <strong className="organization-summary-stat__value">{orgs.length}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--directory">
        <div className="organization-section-head">
          <h2>Moje organizácie</h2>
          <span className="organization-section-subtle">
            {orgs.length > 1 ? "Vyber aktívny pracovný priestor." : "Máš jednu organizáciu."}
          </span>
        </div>
        {orgs.length ? (
          <div className="organization-table-wrap">
            <table className="wizard-models-table">
              <thead>
                <tr>
                  <th>Organizácia</th>
                  <th>Typ</th>
                  <th>Rola</th>
                  <th>Stav</th>
                  <th>Akcia</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const isActive = String(org.id) === String(activeOrgId);
                  const orgCapabilities = getOrgCapabilities(org.role);
                  return (
                    <tr key={org.id}>
                      <td>{org.name || org.id}</td>
                      <td>
                        <span className={`organization-chip ${orgCapabilities.isOwner ? "is-owned" : "is-joined"}`}>
                          {orgCapabilities.isOwner ? "Moja organizácia" : "Pozvaná organizácia"}
                        </span>
                      </td>
                      <td>{getOrgRoleLabel(org.role)}</td>
                      <td>{isActive ? "Aktívna" : "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--small btn-primary"
                          disabled={isActive}
                          onClick={() => handleSelectActiveOrg(org)}
                        >
                          {isActive ? "Aktívna" : "Nastaviť ako aktívnu"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="organization-hint">Zatiaľ nemáš žiadne organizácie.</p>
        )}
        {ownedOrganizations.length ? (
          <p className="organization-hint organization-inline-note">
            Vlastná organizácia: <strong>{ownedOrganizations[0]?.name || "-"}</strong>
          </p>
        ) : null}
        {joinedOrganizations.length ? (
          <p className="organization-hint organization-inline-note">
            Pozvané organizácie: <strong>{joinedOrganizations.length}</strong>
          </p>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--members">
        <div className="organization-section-head">
          <h2>Členovia aktívnej organizácie</h2>
          <span className="organization-section-subtle">
            {activeOrgCapabilities.canManageMembers
              ? "Ako owner spravuješ prístupy a roly."
              : "Zoznam členov je len na čítanie. Správu členov rieši owner."}
          </span>
        </div>
        {!activeOrgId ? <p className="organization-hint">Najprv si vyber aktívnu organizáciu.</p> : null}
        {membersLoading ? <p className="organization-hint">Načítavam členov...</p> : null}
        {membersError ? <p className="auth-message auth-message--error">{membersError}</p> : null}
        {!membersLoading && !membersError && activeOrgId ? (
          <div className="organization-table-wrap">
            <table className="wizard-models-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Rola</th>
                  {activeOrgCapabilities.canManageMembers ? <th>Akcia</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.length ? (
                  members.map((member) => {
                    const memberRole = normalizeOrgRole(member.role);
                    return (
                      <tr key={`${member.email}-${member.role}`}>
                        <td>{member.email}</td>
                        <td>{getOrgRoleLabel(member.role)}</td>
                        {activeOrgCapabilities.canManageMembers ? (
                          <td>
                            <div className="organization-inline-actions">
                              {memberRole === "member" ? (
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  onClick={() => openMemberActionModal("promote", member.email, member.role)}
                                >
                                  Povyšit na ownera
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  onClick={() => openMemberActionModal("demote", member.email, member.role)}
                                >
                                  Zmenit na clena
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--small btn-danger organization-remove-member-btn"
                                onClick={() => openMemberActionModal("remove", member.email, member.role)}
                              >
                                {memberRole === "owner" ? "Vyhodit ownera" : "Vyhodit clena"}
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={activeOrgCapabilities.canManageMembers ? 3 : 2}>V tejto organizácii zatiaľ nie sú žiadni členovia.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {activeOrgCapabilities.canManageMembers ? (
          <form className="organization-form organization-owner-tools" onSubmit={handleAddMember}>
            <h3>Pridať člena</h3>
            <p className="organization-hint">Zadaj email existujúceho používateľa BPMN.Gen.</p>
            <input
              type="email"
              className="wizard-models-search"
              placeholder="Email používateľa"
              value={addMemberEmail}
              onChange={(event) => setAddMemberEmail(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={addMemberLoading || !addMemberEmail.trim()}>
              {addMemberLoading ? "Pridávam..." : "Pridať člena"}
            </button>
            {addMemberError ? <p className="auth-message auth-message--error">{addMemberError}</p> : null}
            {addMemberInfo ? <p className="auth-message auth-message--success">{addMemberInfo}</p> : null}
          </form>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--invites">
        <div className="organization-section-head">
          <h2>Pozvánky do organizácie</h2>
          <span className="organization-section-subtle">Vytvor link pre nového člena tímu.</span>
        </div>
        {activeOrgCapabilities.canManageInvites ? (
          <div className="organization-invite-panel">
            <p className="organization-hint">
              Pozvánka patrí k aktívnej organizácii. Pri regenerovaní vznikne nový link.
            </p>
            <div className="organization-invite-status">
              <span className={`organization-chip organization-chip--invite is-${inviteStatus}`}>{inviteStatusLabel(inviteStatus)}</span>
              <span className="organization-hint">{inviteStatusHint(inviteStatus)}</span>
            </div>
            {inviteMeta?.expires_at ? (
              <p className="organization-hint organization-inline-note">Vyprší: {formatDateTime(inviteMeta.expires_at)}</p>
            ) : null}
            <div className="organization-inline-actions">
              <button
                type="button"
                className="btn btn--small btn-primary"
                onClick={() => handleGetInviteLink(false)}
                disabled={inviteLoading || !activeOrgId}
              >
                {inviteLoading ? "Načítavam..." : "Získať pozývací link"}
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => handleGetInviteLink(true)}
                disabled={inviteLoading || !activeOrgId}
              >
                Regenerovať link
              </button>
            </div>
            <div className="organization-inline-actions">
              <input
                type="text"
                className="wizard-models-search organization-invite-link-input"
                value={inviteLink}
                readOnly
                placeholder="Pozývací link sa zobrazí tu..."
              />
              <button
                type="button"
                className="btn btn--small"
                onClick={handleCopyInvite}
                disabled={!inviteLink || inviteStatus !== "active"}
              >
                {inviteCopied ? "Skopírované" : "Kopírovať"}
              </button>
            </div>
            {inviteError ? <p className="auth-message auth-message--error">{inviteError}</p> : null}
          </div>
        ) : (
          <p className="organization-hint">Pozvánky môže spravovať iba owner aktívnej organizácie.</p>
        )}
      </div>

      <div className="auth-card organization-card organization-card--activity">
        <div className="organization-section-head">
          <h2>
            Aktivita organizacie
            {pendingDeleteRequestCount > 0 ? (
              <span className="project-activity-badge is-pending project-activity-badge--count">
                {pendingDeleteRequestCount}
              </span>
            ) : null}
          </h2>
          <span className="organization-section-subtle">Posledné zmeny v tíme a modeloch.</span>
        </div>
        {!activityLoading && !activityError && pendingDeleteRequestCount === 0 ? (
          <p className="organization-hint">Ziadne poziadavky na odstranenie.</p>
        ) : null}
        {activityLoading ? <p className="organization-hint">Nacitavam aktivitu...</p> : null}
        {activityError ? <p className="auth-message auth-message--error">{activityError}</p> : null}
        {!activityLoading && !activityError ? (
          <div className="organization-info-box organization-info-box--activity">
            {activityItems.length ? (
              <div className="organization-activity-list">
                {activityItems.map((item) => (
                  <div key={item.id} className="organization-activity-item">
                    <strong className="organization-activity-item__title">{describeActivity(item)}</strong>
                    <span className="organization-hint">{formatDateTime(item.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="organization-hint">Zatial tu nie su ziadne zaznamenane udalosti.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--create">
        <div className="organization-section-head">
          <h2>Vytvorenie organizácie</h2>
          <span className="organization-section-subtle">Každý používateľ môže vlastniť jednu organizáciu.</span>
        </div>
        {ownsAnyOrg ? (
          <div className="organization-info-box">
            <p className="organization-hint">
              Vlastnú organizáciu už máš vytvorenú. Do ďalších sa môžeš pridať cez pozývací link.
            </p>
          </div>
        ) : (
          <form className="organization-form" onSubmit={handleCreateOrg}>
            <p className="organization-hint">Vytvor si organizáciu pre tímovú prácu na procesoch.</p>
            <input
              type="text"
              className="wizard-models-search"
              placeholder="Názov organizácie"
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={createLoading || !newOrgName.trim()}>
              {createLoading ? "Vytváram..." : "Vytvoriť organizáciu"}
            </button>
            {createError ? <p className="auth-message auth-message--error">{createError}</p> : null}
            {createInfo ? <p className="auth-message auth-message--success">{createInfo}</p> : null}
          </form>
        )}
      </div>

      {memberActionModal.open ? (
        <div className="wizard-models-modal" onClick={closeMemberActionModal}>
          <div className="wizard-models-panel wizard-models-panel--compact" onClick={(event) => event.stopPropagation()}>
            <div className="wizard-models-header">
              <div className="wizard-dialog-copy">
                <p className="wizard-dialog-kicker">Organizácia</p>
                <h3 className="wizard-dialog-title">{getMemberActionMeta().title}</h3>
                <p className="wizard-dialog-subtitle">{getMemberActionMeta().hint}</p>
              </div>
            </div>
            <div className="wizard-dialog-meta">
              <div className="wizard-dialog-meta__chip">
                <span className="wizard-dialog-meta__label">Člen</span>
                <strong>{memberActionModal.targetEmail}</strong>
              </div>
            </div>
            <input
              type="email"
              className="wizard-models-search"
              placeholder="Zadaj email člena"
              value={memberActionModal.typedEmail}
              onChange={(event) => setMemberActionModal((prev) => ({ ...prev, typedEmail: event.target.value, error: "" }))}
              autoFocus
            />
            {memberActionModal.error ? <p className="auth-message auth-message--error">{memberActionModal.error}</p> : null}
            <div className="wizard-dialog-actions">
              <button type="button" className="btn" onClick={closeMemberActionModal} disabled={memberActionModal.loading}>
                Zrušiť
              </button>
              <button
                type="button"
                className={getMemberActionMeta().submitClass}
                onClick={handleConfirmMemberAction}
                disabled={memberActionModal.loading}
              >
                {getMemberActionMeta().submitLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default OrganizationPage;

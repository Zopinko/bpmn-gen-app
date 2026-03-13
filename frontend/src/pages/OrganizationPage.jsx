import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { addOrgMember, createOrg, getOrgInviteLink, listMyOrgs, listOrgMembers, removeOrgMember } from "../api/wizard";

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

  const [newOrgName, setNewOrgName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createInfo, setCreateInfo] = useState("");
  const [removeModal, setRemoveModal] = useState({
    open: false,
    targetEmail: "",
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
    () => orgs.some((org) => String(org?.role || "").toLowerCase() === "owner"),
    [orgs],
  );
  const ownedOrganizations = useMemo(
    () => orgs.filter((org) => String(org?.role || "").toLowerCase() === "owner"),
    [orgs],
  );
  const joinedOrganizations = useMemo(
    () => orgs.filter((org) => String(org?.role || "").toLowerCase() !== "owner"),
    [orgs],
  );
  const isActiveOrgOwner = String(activeOrg?.role || "").toLowerCase() === "owner";
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
    if (!activeOrgId || !isActiveOrgOwner) {
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
  }, [activeOrgId, isActiveOrgOwner]);

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

  const openRemoveModal = (email) => {
    setRemoveModal({
      open: true,
      targetEmail: email || "",
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const closeRemoveModal = () => {
    if (removeModal.loading) return;
    setRemoveModal({
      open: false,
      targetEmail: "",
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const handleConfirmRemoveMember = async () => {
    const targetEmail = String(removeModal.targetEmail || "").trim().toLowerCase();
    const typedEmail = String(removeModal.typedEmail || "").trim().toLowerCase();
    if (!targetEmail || !typedEmail || typedEmail !== targetEmail) {
      setRemoveModal((prev) => ({ ...prev, error: "Pre potvrdenie prepíš presnú emailovú adresu." }));
      return;
    }
    if (!activeOrgId) {
      setRemoveModal((prev) => ({ ...prev, error: "Najprv vyber aktívnu organizáciu." }));
      return;
    }
    setRemoveModal((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      await removeOrgMember(targetEmail, activeOrgId);
      await refreshMembers();
      setAddMemberInfo(`Používateľ ${targetEmail} bol odstránený z organizácie.`);
      closeRemoveModal();
    } catch (e) {
      setRemoveModal((prev) => ({ ...prev, loading: false, error: e?.message || "Odstránenie člena zlyhalo." }));
    }
  };

  const roleLabel = (role) => (String(role || "").toLowerCase() === "owner" ? "Owner" : "Člen");

  return (
    <section className="organization-page">
      <div className="auth-card organization-card organization-hero">
        <div className="account-card-head">
          <div>
            <h1>Organizácie</h1>
            <p className="organization-intro">
              Tu spravuješ aktívnu organizáciu, členov a pozvánky. V modeli procesu sa vždy používa práve aktívna organizácia.
            </p>
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

      <div className="auth-card organization-card organization-active-card">
        <div className="organization-section-head">
          <h2>Aktívna organizácia</h2>
          <span className="organization-active-badge">Aktívna</span>
        </div>
        {!loading && !orgs.length ? (
          <p className="organization-hint">Zatiaľ nemáš žiadnu organizáciu. Nižšie si môžeš vytvoriť svoju prvú organizáciu.</p>
        ) : (
          <div className="organization-active-grid">
            <div className="account-info-row">
              <span>Názov organizácie</span>
              <strong>{activeOrg?.name || "Nezvolená organizácia"}</strong>
            </div>
            <div className="account-info-row">
              <span>Tvoja rola</span>
              <strong>{roleLabel(activeOrg?.role)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="auth-card organization-card">
        <div className="organization-section-head">
          <h2>Moje organizácie</h2>
          <span className="organization-section-subtle">
            {orgs.length > 1 ? "Vyber, v ktorej organizácii chceš aktuálne pracovať." : "Máš iba jednu organizáciu."}
          </span>
        </div>
        {orgs.length ? (
          <div style={{ overflow: "auto" }}>
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
                  const isOwner = String(org.role || "").toLowerCase() === "owner";
                  return (
                    <tr key={org.id}>
                      <td>{org.name || org.id}</td>
                      <td>
                        <span className={`organization-chip ${isOwner ? "is-owned" : "is-joined"}`}>
                          {isOwner ? "Moja organizácia" : "Pozvaná organizácia"}
                        </span>
                      </td>
                      <td>{roleLabel(org.role)}</td>
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

      <div className="auth-card organization-card">
        <div className="organization-section-head">
          <h2>Členovia aktívnej organizácie</h2>
          <span className="organization-section-subtle">
            {isActiveOrgOwner
              ? "Ako owner môžeš pridávať a odoberať členov."
              : "Zoznam členov je len na zobrazenie. Správu členov rieši owner."}
          </span>
        </div>
        {!activeOrgId ? <p className="organization-hint">Najprv si vyber aktívnu organizáciu.</p> : null}
        {membersLoading ? <p className="organization-hint">Načítavam členov...</p> : null}
        {membersError ? <p className="auth-message auth-message--error">{membersError}</p> : null}
        {!membersLoading && !membersError && activeOrgId ? (
          <div style={{ overflow: "auto" }}>
            <table className="wizard-models-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Rola</th>
                  {isActiveOrgOwner ? <th>Akcia</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.length ? (
                  members.map((member) => (
                    <tr key={`${member.email}-${member.role}`}>
                      <td>{member.email}</td>
                      <td>{roleLabel(member.role)}</td>
                      {isActiveOrgOwner ? (
                        <td>
                          {String(member.role || "").toLowerCase() === "member" ? (
                            <button
                              type="button"
                              className="btn btn--small btn-danger organization-remove-member-btn"
                              onClick={() => openRemoveModal(member.email)}
                            >
                              Vyhodiť člena
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isActiveOrgOwner ? 3 : 2}>V tejto organizácii zatiaľ nie sú žiadni členovia.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {isActiveOrgOwner ? (
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

      <div className="auth-card organization-card">
        <div className="organization-section-head">
          <h2>Pozvánky do organizácie</h2>
          <span className="organization-section-subtle">Vygeneruj link, ktorý pošleš novému členovi.</span>
        </div>
        {isActiveOrgOwner ? (
          <>
            <p className="organization-hint">
              Pozvánka je naviazaná na aktuálne aktívnu organizáciu. Pri regenerovaní sa vygeneruje nový link.
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
                className="wizard-models-search"
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
          </>
        ) : (
          <p className="organization-hint">Pozvánky môže spravovať iba owner aktívnej organizácie.</p>
        )}
      </div>

      <div className="auth-card organization-card">
        <div className="organization-section-head">
          <h2>Vytvorenie organizácie</h2>
          <span className="organization-section-subtle">Každý používateľ môže vlastniť jednu organizáciu.</span>
        </div>
        {ownsAnyOrg ? (
          <div className="organization-info-box">
            <p className="organization-hint">
              Už máš vytvorenú vlastnú organizáciu. Do ďalších organizácií sa môžeš pridať cez pozývací link.
            </p>
          </div>
        ) : (
          <form className="organization-form" onSubmit={handleCreateOrg}>
            <p className="organization-hint">Vytvor si vlastnú organizáciu pre tímovú prácu na procesoch.</p>
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

      {removeModal.open ? (
        <div className="wizard-models-modal" onClick={closeRemoveModal}>
          <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(event) => event.stopPropagation()}>
            <div className="wizard-models-header">
              <h3 style={{ margin: 0 }}>Potvrdenie vyhodenia člena</h3>
            </div>
            <p className="organization-hint" style={{ marginBottom: 10 }}>
              Pre potvrdenie odstránenia člena prepíš presný email:
            </p>
            <p style={{ marginTop: 0, marginBottom: 10, color: "#e5e7eb", fontWeight: 600 }}>{removeModal.targetEmail}</p>
            <input
              type="email"
              className="wizard-models-search"
              placeholder="Zadaj email člena"
              value={removeModal.typedEmail}
              onChange={(event) => setRemoveModal((prev) => ({ ...prev, typedEmail: event.target.value, error: "" }))}
              autoFocus
            />
            {removeModal.error ? <p className="auth-message auth-message--error">{removeModal.error}</p> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" onClick={closeRemoveModal} disabled={removeModal.loading}>
                Zrušiť
              </button>
              <button type="button" className="btn btn-danger" onClick={handleConfirmRemoveMember} disabled={removeModal.loading}>
                {removeModal.loading ? "Odstraňujem..." : "Vyhodiť člena"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default OrganizationPage;

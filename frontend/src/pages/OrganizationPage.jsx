import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  addOrgMember,
  createOrg,
  deleteOrg,
  getOrgInviteLink,
  leaveOrg,
  listMyOrgs,
  listOrgActivity,
  listOrgMembers,
  removeOrgMember,
  updateOrgMemberRole,
} from "../api/wizard";
import { getMe } from "../api/auth";
import { getOrgCapabilities, getOrgRoleLabel, normalizeOrgRole } from "../permissions/orgCapabilities";

function OrganizationPage() {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");

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
  const [deleteOrgModal, setDeleteOrgModal] = useState({
    open: false,
    stage: 1,
    orgId: "",
    orgName: "",
    typedName: "",
    loading: false,
    error: "",
  });

  const [memberActionModal, setMemberActionModal] = useState({
    open: false,
    action: "",
    targetEmail: "",
    targetRole: "",
    typedEmail: "",
    loading: false,
    error: "",
  });
  const [leaveOrgModal, setLeaveOrgModal] = useState({
    open: false,
    orgId: "",
    orgName: "",
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
        setError(e?.message || t("org.load_error"));
        setOrgs([]);
      } finally {
        setLoading(false);
      }
    },
    [applyActiveOrg, t],
  );

  const activeOrg = useMemo(
    () => orgs.find((org) => String(org.id) === String(activeOrgId)) || null,
    [orgs, activeOrgId],
  );
  const ownsAnyOrg = useMemo(() => orgs.some((org) => normalizeOrgRole(org?.role) === "owner"), [orgs]);
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
    if (status === "active") return t("org.invite_status_active");
    if (status === "expired") return t("org.invite_status_expired");
    if (status === "revoked") return t("org.invite_status_revoked");
    if (status === "used") return t("org.invite_status_used");
    return t("org.invite_status_none");
  };

  const inviteStatusHint = (status) => {
    if (status === "active") {
      return inviteMeta?.expires_at
        ? t("org.invite_hint_active_date", { date: formatDateTime(inviteMeta.expires_at) })
        : t("org.invite_hint_active");
    }
    if (status === "expired") return t("org.invite_hint_expired");
    if (status === "revoked") return t("org.invite_hint_revoked");
    if (status === "used") return t("org.invite_hint_used");
    return t("org.invite_hint_none");
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
      setMembersError(e?.message || t("org.members_error"));
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [activeOrgId, t]);

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
      setInviteError(e?.message || t("org.invite_status_error"));
    } finally {
      setInviteLoading(false);
    }
  }, [activeOrgCapabilities.canManageInvites, activeOrgId, t]);

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
      setActivityError(e?.message || t("org.activity_error"));
    } finally {
      setActivityLoading(false);
    }
  }, [activeOrgId, t]);

  useEffect(() => {
    void refreshOrgs();
  }, [refreshOrgs]);

  useEffect(() => {
    let ignore = false;
    const loadCurrentUser = async () => {
      try {
        const response = await getMe();
        if (!ignore) setCurrentUserEmail(String(response?.user?.email || ""));
      } catch {
        if (!ignore) setCurrentUserEmail("");
      }
    };
    void loadCurrentUser();
    return () => {
      ignore = true;
    };
  }, []);

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
      setCreateInfo(t("org.create_success"));
      setNewOrgName("");
      await refreshOrgs(created?.id || "");
    } catch (e) {
      setCreateError(e?.message || t("org.create_error"));
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
        setAddMemberInfo(t("org.add_member_already"));
      } else {
        setAddMemberInfo(t("org.add_member_success"));
      }
      setAddMemberEmail("");
      await refreshMembers();
    } catch (e) {
      setAddMemberError(e?.message || t("org.add_member_error"));
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleGetInviteLink = async (regenerate = false) => {
    if (!activeOrgId) {
      setInviteError(t("org.invite_no_org"));
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
      setInviteError(e?.message || t("org.invite_get_error"));
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
      setInviteError(t("org.invite_copy_error"));
    }
  };

  const openDeleteOrgModal = (org) => {
    setDeleteOrgModal({
      open: true,
      stage: 1,
      orgId: String(org?.id || ""),
      orgName: String(org?.name || org?.id || ""),
      typedName: "",
      loading: false,
      error: "",
    });
  };

  const closeDeleteOrgModal = () => {
    if (deleteOrgModal.loading) return;
    setDeleteOrgModal({
      open: false,
      stage: 1,
      orgId: "",
      orgName: "",
      typedName: "",
      loading: false,
      error: "",
    });
  };

  const handleDeleteOrgContinue = () => {
    setDeleteOrgModal((prev) => ({ ...prev, stage: 2, error: "" }));
  };

  const handleConfirmDeleteOrg = async () => {
    const targetName = String(deleteOrgModal.orgName || "").trim();
    const typedName = String(deleteOrgModal.typedName || "").trim();
    const orgId = String(deleteOrgModal.orgId || "").trim();

    if (!orgId) {
      setDeleteOrgModal((prev) => ({ ...prev, error: t("org.delete_id_error") }));
      return;
    }
    if (!targetName || typedName !== targetName) {
      setDeleteOrgModal((prev) => ({ ...prev, error: t("org.delete_name_mismatch") }));
      return;
    }

    setDeleteOrgModal((prev) => ({ ...prev, loading: true, error: "" }));
    setCreateError("");
    setCreateInfo("");

    try {
      await deleteOrg(orgId);
      setCreateInfo(t("org.delete_success", { name: targetName }));
      closeDeleteOrgModal();
      await refreshOrgs(String(activeOrgId) === orgId ? "" : activeOrgId);
      if (String(activeOrgId) !== orgId) {
        await refreshMembers();
      }
    } catch (e) {
      setDeleteOrgModal((prev) => ({ ...prev, loading: false, error: e?.message || t("org.delete_error") }));
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

  const openLeaveOrgModal = (org) => {
    setLeaveOrgModal({
      open: true,
      orgId: String(org?.id || ""),
      orgName: String(org?.name || org?.id || ""),
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const closeLeaveOrgModal = () => {
    if (leaveOrgModal.loading) return;
    setLeaveOrgModal({
      open: false,
      orgId: "",
      orgName: "",
      typedEmail: "",
      loading: false,
      error: "",
    });
  };

  const handleConfirmLeaveOrg = async () => {
    const orgId = String(leaveOrgModal.orgId || "").trim();
    const typedEmail = String(leaveOrgModal.typedEmail || "").trim().toLowerCase();
    const ownEmail = String(currentUserEmail || "").trim().toLowerCase();

    if (!orgId) {
      setLeaveOrgModal((prev) => ({ ...prev, error: t("org.leave_id_error") }));
      return;
    }
    if (!ownEmail || typedEmail !== ownEmail) {
      setLeaveOrgModal((prev) => ({ ...prev, error: t("org.leave_email_mismatch") }));
      return;
    }

    setLeaveOrgModal((prev) => ({ ...prev, loading: true, error: "" }));
    setCreateError("");
    setCreateInfo("");

    try {
      await leaveOrg(orgId);
      setCreateInfo(t("org.leave_success", { name: leaveOrgModal.orgName }));
      closeLeaveOrgModal();
      await refreshOrgs(String(activeOrgId) === orgId ? "" : activeOrgId);
      if (String(activeOrgId) !== orgId) {
        await refreshMembers();
      }
    } catch (e) {
      setLeaveOrgModal((prev) => ({
        ...prev,
        loading: false,
        error: e?.message || t("org.leave_error"),
      }));
    }
  };

  const handleConfirmMemberAction = async () => {
    const targetEmail = String(memberActionModal.targetEmail || "").trim().toLowerCase();
    const typedEmail = String(memberActionModal.typedEmail || "").trim().toLowerCase();
    const action = String(memberActionModal.action || "");

    if (!targetEmail || !typedEmail || typedEmail !== targetEmail) {
      setMemberActionModal((prev) => ({ ...prev, error: t("org.member_email_mismatch") }));
      return;
    }
    if (!activeOrgId) {
      setMemberActionModal((prev) => ({ ...prev, error: t("org.member_no_org") }));
      return;
    }

    setMemberActionModal((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      if (action === "promote") {
        await updateOrgMemberRole(targetEmail, activeOrgId, "owner");
        setAddMemberInfo(t("org.promote_success", { email: targetEmail }));
      } else if (action === "demote") {
        await updateOrgMemberRole(targetEmail, activeOrgId, "member");
        setAddMemberInfo(t("org.demote_success", { email: targetEmail }));
      } else if (action === "viewer") {
        await updateOrgMemberRole(targetEmail, activeOrgId, "viewer");
        setAddMemberInfo(t("org.viewer_success", { email: targetEmail }));
      } else {
        await removeOrgMember(targetEmail, activeOrgId);
        setAddMemberInfo(t("org.remove_success", { email: targetEmail }));
      }

      await refreshOrgs(activeOrgId);
      await refreshMembers();
      closeMemberActionModal();
    } catch (e) {
      setMemberActionModal((prev) => ({ ...prev, loading: false, error: e?.message || t("org.member_error") }));
    }
  };

  const describeActivity = (item) => {
    const actor = item?.actor_email || t("org.act_unknown_user");
    const name = item?.entity_name || item?.entity_id || t("org.act_default_name");
    const type = String(item?.event_type || "").toLowerCase();

    if (type === "process_created") return t("org.act_process_created", { actor, name });
    if (type === "process_renamed") return t("org.act_process_renamed", { actor, name });
    if (type === "process_moved") return t("org.act_process_moved", { actor, name });
    if (type === "process_deleted") return t("org.act_process_deleted", { actor, name });
    if (type === "model_pushed_to_org") return t("org.act_model_pushed_to_org", { actor, name });
    if (type === "member_added") return t("org.act_member_added", { actor, name });
    if (type === "member_removed") return t("org.act_member_removed", { actor, name });
    if (type === "member_role_updated") return t("org.act_member_role_updated", { actor, name });
    if (type === "invite_link_created") return t("org.act_invite_link_created", { actor });
    if (type === "invite_link_regenerated") return t("org.act_invite_link_regenerated", { actor });
    if (type === "delete_requested") return t("org.act_delete_requested", { actor, name });
    if (type === "delete_request_approved") return t("org.act_delete_request_approved", { actor, name });
    if (type === "delete_request_rejected") return t("org.act_delete_request_rejected", { actor, name });
    return t("org.act_default", { actor, type: type || "unknown" });
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
  const activeOrgStatusLabel = activeOrgCapabilities.canManageMembers ? t("org.status_owner") : t("org.status_member");

  const getMemberActionMeta = () => {
    const action = String(memberActionModal.action || "");
    if (action === "promote") {
      return {
        title: t("org.promote_title"),
        hint: t("org.promote_hint"),
        submitLabel: memberActionModal.loading ? t("org.promote_loading") : t("org.promote_submit"),
        submitClass: "btn btn-primary",
      };
    }
    if (action === "demote") {
      return {
        title: t("org.demote_title"),
        hint: t("org.demote_hint"),
        submitLabel: memberActionModal.loading ? t("org.demote_loading") : t("org.demote_submit"),
        submitClass: "btn btn-danger",
      };
    }
    if (action === "viewer") {
      return {
        title: t("org.viewer_title"),
        hint: t("org.viewer_hint"),
        submitLabel: memberActionModal.loading ? t("org.viewer_loading") : t("org.viewer_submit"),
        submitClass: "btn",
      };
    }
    return {
      title: t("org.remove_title"),
      hint: t("org.remove_hint"),
      submitLabel: memberActionModal.loading ? t("org.remove_loading") : t("org.remove_submit"),
      submitClass: "btn btn-danger",
    };
  };

  return (
    <section className="organization-page">
      <div className="auth-card organization-card organization-hero">
        <div className="account-card-head">
          <div>
            <p className="auth-eyebrow">{t("org.eyebrow")}</p>
            <h1>{t("org.title")}</h1>
            <p className="organization-intro">{t("org.intro")}</p>
          </div>
          <div className="account-card-head__actions">
            <Link to="/" className="btn app-nav__link-btn">
              {t("org.back")}
            </Link>
          </div>
        </div>
        {loading ? <p className="organization-hint">{t("org.loading_orgs")}</p> : null}
        {error ? <p className="auth-message auth-message--error">{error}</p> : null}
      </div>

      <div className="auth-card organization-card organization-summary-card">
        <div className="organization-summary-head">
          <div className="organization-summary-head__copy">
            <div className="organization-section-head">
              <h2>{t("org.active_org_title")}</h2>
              <span className="organization-active-badge">{t("org.active_badge")}</span>
            </div>
            <div className="organization-summary-title-row">
              <h3>{activeOrg?.name || t("org.no_active_org")}</h3>
              <span className="organization-summary-role">{getOrgRoleLabel(activeOrg?.role) || "-"}</span>
            </div>
            <p className="organization-hint">
              {!loading && !orgs.length ? t("org.no_orgs_hint") : t("org.summary_hint")}
            </p>
          </div>
          <div className="organization-summary-status">{activeOrgStatusLabel}</div>
        </div>

        {!loading && orgs.length ? (
          <div className="organization-summary-grid">
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">{t("org.stat_my_role")}</span>
              <strong className="organization-summary-stat__value">{getOrgRoleLabel(activeOrg?.role)}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">{t("org.stat_members")}</span>
              <strong className="organization-summary-stat__value">{memberCount}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">{t("org.stat_pending")}</span>
              <strong className="organization-summary-stat__value">{pendingDeleteRequestCount}</strong>
            </div>
            <div className="organization-summary-stat">
              <span className="organization-summary-stat__label">{t("org.stat_my_orgs")}</span>
              <strong className="organization-summary-stat__value">{orgs.length}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--directory">
        <div className="organization-section-head">
          <h2>{t("org.dir_title")}</h2>
          <span className="organization-section-subtle">
            {orgs.length > 1 ? t("org.dir_select_org") : t("org.dir_one_org")}
          </span>
        </div>

        {orgs.length ? (
          <div className="organization-table-wrap">
            <table className="wizard-models-table">
              <thead>
                <tr>
                  <th>{t("org.col_org")}</th>
                  <th>{t("org.col_type")}</th>
                  <th>{t("org.col_role")}</th>
                  <th>{t("org.col_status")}</th>
                  <th>{t("org.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const isActive = String(org.id) === String(activeOrgId);
                  const orgCapabilities = getOrgCapabilities(org.role);
                  const canDelete = orgCapabilities.isOwner;
                  const canLeave = !orgCapabilities.isOwner;
                  return (
                    <tr key={org.id}>
                      <td>{org.name || org.id}</td>
                      <td>
                        <span className={`organization-chip ${orgCapabilities.isOwner ? "is-owned" : "is-joined"}`}>
                          {orgCapabilities.isOwner ? t("org.type_owned") : t("org.type_joined")}
                        </span>
                      </td>
                      <td>{getOrgRoleLabel(org.role)}</td>
                      <td>{isActive ? t("org.active_badge") : "-"}</td>
                      <td>
                        <div className="organization-inline-actions">
                          <button
                            type="button"
                            className="btn btn--small btn-primary"
                            disabled={isActive}
                            onClick={() => handleSelectActiveOrg(org)}
                          >
                            {isActive ? t("org.active_badge") : t("org.set_active")}
                          </button>
                          {canDelete ? (
                            <button
                              type="button"
                              className="btn btn--small btn-danger"
                              onClick={() => openDeleteOrgModal(org)}
                            >
                              {t("org.delete_org_btn")}
                            </button>
                          ) : null}
                          {canLeave ? (
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => openLeaveOrgModal(org)}
                            >
                              {t("org.leave_org_btn")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="organization-hint">{t("org.no_orgs")}</p>
        )}

        {ownedOrganizations.length ? (
          <p className="organization-hint organization-inline-note">
            {t("org.owned_org_note")} <strong>{ownedOrganizations[0]?.name || "-"}</strong>
          </p>
        ) : null}
        {joinedOrganizations.length ? (
          <p className="organization-hint organization-inline-note">
            {t("org.joined_orgs_note")} <strong>{joinedOrganizations.length}</strong>
          </p>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--members">
        <div className="organization-section-head">
          <h2>{t("org.members_title")}</h2>
          <span className="organization-section-subtle">
            {activeOrgCapabilities.canManageMembers ? t("org.members_hint_owner") : t("org.members_hint_member")}
          </span>
        </div>

        {!activeOrgId ? <p className="organization-hint">{t("org.no_active_org_hint")}</p> : null}
        {membersLoading ? <p className="organization-hint">{t("org.loading_members")}</p> : null}
        {membersError ? <p className="auth-message auth-message--error">{membersError}</p> : null}

        {!membersLoading && !membersError && activeOrgId ? (
          <div className="organization-table-wrap">
            <table className="wizard-models-table">
              <thead>
                <tr>
                  <th>{t("org.col_email")}</th>
                  <th>{t("org.col_role")}</th>
                  {activeOrgCapabilities.canManageMembers ? <th>{t("org.col_action")}</th> : null}
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
                                <>
                                  <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => openMemberActionModal("promote", member.email, member.role)}
                                  >
                                    {t("org.promote_to_owner")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => openMemberActionModal("viewer", member.email, member.role)}
                                  >
                                    {t("org.promote_to_viewer")}
                                  </button>
                                </>
                              ) : memberRole === "viewer" ? (
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  onClick={() => openMemberActionModal("demote", member.email, member.role)}
                                >
                                  {t("org.demote_to_member")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  onClick={() => openMemberActionModal("demote", member.email, member.role)}
                                >
                                  {t("org.demote_to_member")}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--small btn-danger organization-remove-member-btn"
                                onClick={() => openMemberActionModal("remove", member.email, member.role)}
                              >
                                {memberRole === "owner"
                                  ? t("org.kick_owner")
                                  : memberRole === "viewer"
                                    ? t("org.kick_viewer")
                                    : t("org.kick_member")}
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={activeOrgCapabilities.canManageMembers ? 3 : 2}>
                      {t("org.no_members")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeOrgCapabilities.canManageMembers ? (
          <form className="organization-form organization-owner-tools" onSubmit={handleAddMember}>
            <h3>{t("org.add_member_title")}</h3>
            <p className="organization-hint">{t("org.add_member_hint")}</p>
            <input
              type="email"
              className="wizard-models-search"
              placeholder={t("org.add_member_placeholder")}
              value={addMemberEmail}
              onChange={(event) => setAddMemberEmail(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={addMemberLoading || !addMemberEmail.trim()}>
              {addMemberLoading ? t("org.add_member_loading") : t("org.add_member_submit")}
            </button>
            {addMemberError ? <p className="auth-message auth-message--error">{addMemberError}</p> : null}
            {addMemberInfo ? <p className="auth-message auth-message--success">{addMemberInfo}</p> : null}
          </form>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--invites">
        <div className="organization-section-head">
          <h2>{t("org.invites_title")}</h2>
          <span className="organization-section-subtle">{t("org.invites_subtitle")}</span>
        </div>

        {activeOrgCapabilities.canManageInvites ? (
          <div className="organization-invite-panel">
            <p className="organization-hint">{t("org.invite_hint")}</p>
            <div className="organization-invite-status">
              <span className={`organization-chip organization-chip--invite is-${inviteStatus}`}>
                {inviteStatusLabel(inviteStatus)}
              </span>
              <span className="organization-hint">{inviteStatusHint(inviteStatus)}</span>
            </div>
            {inviteMeta?.expires_at ? (
              <p className="organization-hint organization-inline-note">
                {t("org.invite_expires", { date: formatDateTime(inviteMeta.expires_at) })}
              </p>
            ) : null}
            <div className="organization-inline-actions">
              <button
                type="button"
                className="btn btn--small btn-primary"
                onClick={() => handleGetInviteLink(false)}
                disabled={inviteLoading || !activeOrgId}
              >
                {inviteLoading ? t("org.invite_get_loading") : t("org.invite_get")}
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => handleGetInviteLink(true)}
                disabled={inviteLoading || !activeOrgId}
              >
                {t("org.invite_regenerate")}
              </button>
            </div>
            <div className="organization-inline-actions">
              <input
                type="text"
                className="wizard-models-search organization-invite-link-input"
                value={inviteLink}
                readOnly
                placeholder={t("org.invite_placeholder")}
              />
              <button
                type="button"
                className="btn btn--small"
                onClick={handleCopyInvite}
                disabled={!inviteLink || inviteStatus !== "active"}
              >
                {inviteCopied ? t("org.invite_copied") : t("org.invite_copy")}
              </button>
            </div>
            {inviteError ? <p className="auth-message auth-message--error">{inviteError}</p> : null}
          </div>
        ) : (
          <p className="organization-hint">{t("org.invite_owner_only")}</p>
        )}
      </div>

      <div className="auth-card organization-card organization-card--activity">
        <div className="organization-section-head">
          <h2>
            {t("org.activity_title")}
            {pendingDeleteRequestCount > 0 ? (
              <span className="project-activity-badge is-pending project-activity-badge--count">
                {pendingDeleteRequestCount}
              </span>
            ) : null}
          </h2>
          <span className="organization-section-subtle">{t("org.activity_subtitle")}</span>
        </div>

        {!activityLoading && !activityError && pendingDeleteRequestCount === 0 ? (
          <p className="organization-hint">{t("org.no_pending")}</p>
        ) : null}
        {activityLoading ? <p className="organization-hint">{t("org.loading_activity")}</p> : null}
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
              <p className="organization-hint">{t("org.no_activity")}</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="auth-card organization-card organization-card--create">
        <div className="organization-section-head">
          <h2>{t("org.create_title")}</h2>
          <span className="organization-section-subtle">{t("org.create_subtitle")}</span>
        </div>

        {ownsAnyOrg ? (
          <div className="organization-info-box">
            <p className="organization-hint">{t("org.create_owns_already")}</p>
          </div>
        ) : (
          <form className="organization-form" onSubmit={handleCreateOrg}>
            <p className="organization-hint">{t("org.create_hint")}</p>
            <input
              type="text"
              className="wizard-models-search"
              placeholder={t("org.create_placeholder")}
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={createLoading || !newOrgName.trim()}>
              {createLoading ? t("org.create_loading") : t("org.create_submit")}
            </button>
            {createError ? <p className="auth-message auth-message--error">{createError}</p> : null}
            {createInfo ? <p className="auth-message auth-message--success">{createInfo}</p> : null}
          </form>
        )}
      </div>

      {deleteOrgModal.open ? (
        <div className="wizard-models-modal" onClick={closeDeleteOrgModal}>
          <div className="wizard-models-panel wizard-models-panel--compact" onClick={(event) => event.stopPropagation()}>
            <div className="wizard-models-header">
              <div className="wizard-dialog-copy">
                <p className="wizard-dialog-kicker">{t("org.delete_kicker")}</p>
                <h3 className="wizard-dialog-title">{t("org.delete_title")}</h3>
                <p className="wizard-dialog-subtitle">
                  {deleteOrgModal.stage === 1 ? t("org.delete_stage1_subtitle") : t("org.delete_stage2_subtitle")}
                </p>
              </div>
            </div>
            <div className="wizard-dialog-meta">
              <div className="wizard-dialog-meta__chip">
                <span className="wizard-dialog-meta__label">{t("org.delete_meta_label")}</span>
                <strong>{deleteOrgModal.orgName}</strong>
              </div>
            </div>
            {deleteOrgModal.stage === 1 ? (
              <div className="organization-info-box">
                <p className="organization-hint">{t("org.delete_stage1_hint")}</p>
              </div>
            ) : (
              <input
                type="text"
                className="wizard-models-search"
                placeholder={t("org.delete_placeholder")}
                value={deleteOrgModal.typedName}
                onChange={(event) =>
                  setDeleteOrgModal((prev) => ({ ...prev, typedName: event.target.value, error: "" }))
                }
                autoFocus
              />
            )}
            {deleteOrgModal.error ? <p className="auth-message auth-message--error">{deleteOrgModal.error}</p> : null}
            <div className="wizard-dialog-actions">
              <button type="button" className="btn" onClick={closeDeleteOrgModal} disabled={deleteOrgModal.loading}>
                {t("org.delete_cancel")}
              </button>
              {deleteOrgModal.stage === 1 ? (
                <button type="button" className="btn btn-danger" onClick={handleDeleteOrgContinue}>
                  {t("org.delete_continue")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleConfirmDeleteOrg}
                  disabled={deleteOrgModal.loading}
                >
                  {deleteOrgModal.loading ? t("org.delete_loading") : t("org.delete_confirm")}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {memberActionModal.open ? (
        <div className="wizard-models-modal" onClick={closeMemberActionModal}>
          <div className="wizard-models-panel wizard-models-panel--compact" onClick={(event) => event.stopPropagation()}>
            <div className="wizard-models-header">
              <div className="wizard-dialog-copy">
                <p className="wizard-dialog-kicker">{t("org.member_kicker")}</p>
                <h3 className="wizard-dialog-title">{getMemberActionMeta().title}</h3>
                <p className="wizard-dialog-subtitle">{getMemberActionMeta().hint}</p>
              </div>
            </div>
            <div className="wizard-dialog-meta">
              <div className="wizard-dialog-meta__chip">
                <span className="wizard-dialog-meta__label">{t("org.member_meta_label")}</span>
                <strong>{memberActionModal.targetEmail}</strong>
              </div>
            </div>
            <input
              type="email"
              className="wizard-models-search"
              placeholder={t("org.member_email_placeholder")}
              value={memberActionModal.typedEmail}
              onChange={(event) => setMemberActionModal((prev) => ({ ...prev, typedEmail: event.target.value, error: "" }))}
              autoFocus
            />
            {memberActionModal.error ? <p className="auth-message auth-message--error">{memberActionModal.error}</p> : null}
            <div className="wizard-dialog-actions">
              <button type="button" className="btn" onClick={closeMemberActionModal} disabled={memberActionModal.loading}>
                {t("org.member_cancel")}
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

      {leaveOrgModal.open ? (
        <div className="wizard-models-modal" onClick={closeLeaveOrgModal}>
          <div className="wizard-models-panel wizard-models-panel--compact" onClick={(event) => event.stopPropagation()}>
            <div className="wizard-models-header">
              <div className="wizard-dialog-copy">
                <p className="wizard-dialog-kicker">{t("org.leave_kicker")}</p>
                <h3 className="wizard-dialog-title">{t("org.leave_title")}</h3>
                <p className="wizard-dialog-subtitle">{t("org.leave_subtitle")}</p>
              </div>
            </div>
            <div className="wizard-dialog-meta">
              <div className="wizard-dialog-meta__chip">
                <span className="wizard-dialog-meta__label">{t("org.leave_meta_org")}</span>
                <strong>{leaveOrgModal.orgName}</strong>
              </div>
              <div className="wizard-dialog-meta__chip">
                <span className="wizard-dialog-meta__label">{t("org.leave_meta_email")}</span>
                <strong>{currentUserEmail || "-"}</strong>
              </div>
            </div>
            <div className="organization-info-box">
              <p className="organization-hint">{t("org.leave_hint")}</p>
            </div>
            <input
              type="email"
              className="wizard-models-search"
              placeholder={t("org.leave_placeholder")}
              value={leaveOrgModal.typedEmail}
              onChange={(event) => setLeaveOrgModal((prev) => ({ ...prev, typedEmail: event.target.value, error: "" }))}
              autoFocus
            />
            {leaveOrgModal.error ? <p className="auth-message auth-message--error">{leaveOrgModal.error}</p> : null}
            <div className="wizard-dialog-actions">
              <button type="button" className="btn" onClick={closeLeaveOrgModal} disabled={leaveOrgModal.loading}>
                {t("org.leave_cancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmLeaveOrg}
                disabled={leaveOrgModal.loading}
              >
                {leaveOrgModal.loading ? t("org.leave_loading") : t("org.leave_confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default OrganizationPage;

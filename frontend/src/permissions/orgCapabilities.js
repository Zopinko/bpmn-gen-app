export function normalizeOrgRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "admin") return "owner";
  if (normalized === "owner") return "owner";
  if (normalized === "member") return "member";
  if (normalized === "viewer") return "viewer";
  return "";
}

export function getOrgCapabilities(role) {
  const normalizedRole = normalizeOrgRole(role);
  const isOwner = normalizedRole === "owner";
  const isMember = normalizedRole === "member";
  const isViewer = normalizedRole === "viewer";
  const canViewOrgWorkspace = isOwner || isMember || isViewer;
  const canEditOrgModels = isOwner || isMember;

  return {
    role: normalizedRole,
    isOwner,
    isMember,
    isViewer,
    canViewOrgWorkspace,
    canEditOrgModels,
    canToggleOrgEdit: canEditOrgModels,
    canDirectDeleteOrgProcess: isOwner,
    canRequestDeleteOrgProcess: isMember,
    canApproveDeleteRequests: isOwner,
    canManageMembers: isOwner,
    canManageInvites: isOwner,
    canEditProjectNotes: canEditOrgModels,
    canViewActivityFeed: canViewOrgWorkspace,
  };
}

export function getOrgRoleLabel(role) {
  const normalizedRole = normalizeOrgRole(role);
  if (normalizedRole === "owner") return "Owner";
  if (normalizedRole === "viewer") return "Viewer";
  return "Člen";
}

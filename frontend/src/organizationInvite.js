export const PENDING_ORG_INVITE_KEY = "PENDING_ORG_INVITE_TOKEN";

export function orgInvitePath(token) {
  return `/join-org#${new URLSearchParams({ token })}`;
}

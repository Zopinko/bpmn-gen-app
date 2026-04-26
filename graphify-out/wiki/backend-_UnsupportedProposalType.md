# backend: UnsupportedProposalType

> 88 nodes · cohesion 0.05

## Key Concepts

- **BaseModel** (47 connections)
- **orgs_router.py** (32 connections) — `backend\routers\orgs_router.py`
- **AuthUser** (24 connections) — `backend\auth\service.py`
- **models.py** (23 connections) — `backend\mentor\models.py`
- **auth_router.py** (20 connections) — `backend\routers\auth_router.py`
- **_resolve_org_id()** (18 connections) — `backend\routers\orgs_router.py`
- **UnsupportedProposalType** (8 connections) — `backend\mentor\applier.py`
- **_enforce_rate_limit()** (7 connections) — `backend\routers\auth_router.py`
- **MentorRuleService** (6 connections) — `backend\mentor\rule_service.py`
- **MentorFinding** (5 connections) — `backend\mentor\models.py`
- **MentorRuleError** (5 connections) — `backend\mentor\rule_service.py`
- **login()** (4 connections) — `backend\routers\auth_router.py`
- **_resolve_cookie_domain()** (4 connections) — `backend\routers\auth_router.py`
- **_user_payload()** (4 connections) — `backend\routers\auth_router.py`
- **MentorApplyAudit** (4 connections) — `backend\mentor\models.py`
- **MentorApplyRequest** (4 connections) — `backend\mentor\models.py`
- **MentorApplyResponse** (4 connections) — `backend\mentor\models.py`
- **MentorEngineApplyAuditEntry** (4 connections) — `backend\mentor\models.py`
- **MentorReviewRequest** (4 connections) — `backend\mentor\models.py`
- **Proposal** (4 connections) — `backend\mentor\models.py`
- **approve_org_process_delete_request()** (4 connections) — `backend\routers\orgs_router.py`
- **reject_org_process_delete_request()** (4 connections) — `backend\routers\orgs_router.py`
- **change_password_logged_in()** (3 connections) — `backend\routers\auth_router.py`
- **ChangePasswordRequest** (3 connections) — `backend\routers\auth_router.py`
- **_clear_session_cookie()** (3 connections) — `backend\routers\auth_router.py`
- *... and 63 more nodes in this community*

## Relationships

- [[backend: MentorApplyConflict]] (1 shared connections)

## Source Files

- `backend\auth\service.py`
- `backend\mentor\applier.py`
- `backend\mentor\models.py`
- `backend\mentor\rule_service.py`
- `backend\routers\auth_router.py`
- `backend\routers\orgs_router.py`

## Audit Trail

- EXTRACTED: 158 (87%)
- INFERRED: 24 (13%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*
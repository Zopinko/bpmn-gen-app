# backend: Deterministically build a linear engine_json from a wizard payload without any A

> 57 nodes · cohesion 0.08

## Key Concepts

- **bpmn_svc.py** (18 connections) — `backend\services\bpmn_svc.py`
- **generate_router.py** (17 connections) — `backend\routers\generate_router.py`
- **LinearWizardRequest** (14 connections) — `schemas\wizard.py`
- **LaneAppendRequest** (13 connections) — `backend\schemas\wizard.py`
- **Naèíta BPMN XML (.bpmn) a skonvertuje ho na engine_json použite¾né vo wizarde.** (9 connections) — `backend\routers\generate_router.py`
- **Uloží model s engine_json a aktuálnym BPMN XML (DI) do perzistentného úložiska.** (9 connections) — `backend\routers\generate_router.py`
- **Jednoduché listovanie uložených modelov (perzistentné úložisko).** (9 connections) — `backend\routers\generate_router.py`
- **Convenience endpoint:     - expects payload with engine_json     - generates B** (9 connections) — `backend\routers\generate_router.py`
- **Build a simple linear BPMN diagram from a wizard payload without any AI calls.** (9 connections) — `backend\routers\generate_router.py`
- **Export engine_json (wizard) ako BPMN 2.0 XML na stiahnutie.      Ak klient poš** (9 connections) — `backend\routers\generate_router.py`
- **LinearWizardResponse** (9 connections) — `schemas\wizard.py`
- **WizardModelBase** (9 connections) — `backend\schemas\wizard.py`
- **json_to_bpmn()** (8 connections) — `backend\services\bpmn_svc.py`
- **LaneAppendResponse** (8 connections) — `backend\schemas\wizard.py`
- **WizardModelDetail** (8 connections) — `backend\schemas\wizard.py`
- **WizardModelList** (8 connections) — `backend\schemas\wizard.py`
- **wizard.py** (7 connections) — `backend\schemas\wizard.py`
- **append_tasks_to_lane_from_description()** (5 connections) — `backend\services\bpmn_svc.py`
- **build_linear_engine_from_wizard()** (5 connections) — `backend\services\bpmn_svc.py`
- **_add_event_definition()** (4 connections) — `backend\services\bpmn_svc.py`
- **_expand_conditional_step()** (4 connections) — `backend\services\bpmn_svc.py`
- **_expand_parallel_step()** (4 connections) — `backend\services\bpmn_svc.py`
- **_normalize_node_type()** (4 connections) — `backend\services\bpmn_svc.py`
- **T()** (4 connections) — `backend\services\bpmn_svc.py`
- **_as_bpmn_download()** (4 connections) — `backend\routers\generate_router.py`
- *... and 32 more nodes in this community*

## Relationships

- [[backend: UnsupportedProposalType]] (12 shared connections)

## Source Files

- `backend\routers\generate_router.py`
- `backend\schemas\wizard.py`
- `backend\services\bpmn_svc.py`
- `schemas\wizard.py`

## Audit Trail

- EXTRACTED: 84 (59%)
- INFERRED: 58 (41%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*
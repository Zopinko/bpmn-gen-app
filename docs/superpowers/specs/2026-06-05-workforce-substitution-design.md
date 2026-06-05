# Workforce & Substitutability Design

**Date:** 2026-06-05  
**Project:** bpmn-gen-app  
**Status:** Approved

---

## Overview

Add a workforce layer to process maps that tracks which employees are competent at which process steps, enabling managers to quickly identify substitutes when someone is absent. The feature has two surfaces:

1. **Overlay on the process map** — toggle to see who can do each step, with risk coloring
2. **Org-wide substitutability matrix** — auto-generated from all process maps, shows coverage gaps

---

## Context & Problem

Currently, BPMN lanes represent roles or departments (e.g. "Nákup", "Sklad") but carry no information about which specific people perform those steps. When an employee is absent, there is no quick way to find out:
- Who else knows this step well enough to substitute?
- Which steps have no backup at all (single point of failure)?

The goal is to make this visible without changing how process maps are built today.

---

## Decisions Made

| Question | Decision |
|---|---|
| What is an executor? | Standalone employee record — not tied to an app account. Stored as data in the org. |
| Granularity | Task/step level. Each lane also has an optional `owner_emp_id` (responsible person for the role). |
| Architecture | Org-level central storage (`employees.json` + `competencies.json`) — follows existing file-based pattern. |
| Competency levels | 3 levels: `primary` / `backup` / `training` |
| Employee registry | Centralized per org with inline-add capability. Employee number (`emp_no`) is the human-readable identifier. |
| Org matrix | Auto-generated from competencies — no separate data entry. |

---

## Data Model

### `orgs/{org_id}/employees.json`

Central employee register for the org. One entry per person.

```json
[
  {
    "id": "uuid",
    "emp_no": "E001",
    "name": "Jana Kováčová",
    "position": "Referentka nákupu",
    "created_at": "2026-06-05T10:00:00Z"
  }
]
```

Fields:
- `id` — internal UUID, used in references
- `emp_no` — human-readable employee number, unique within org, primary identifier in UI
- `name` — full name
- `position` — job title / position (free text)
- `created_at` — ISO timestamp

### `orgs/{org_id}/competencies.json`

Maps employees to process steps with a competency level.

```json
[
  {
    "id": "uuid",
    "emp_id": "uuid",
    "process_node_id": "node_abc123",
    "step_id": "task_001",
    "level": "primary"
  }
]
```

Fields:
- `emp_id` — FK to employee
- `process_node_id` — org model tree node ID (the process)
- `step_id` — node ID inside `engine_json` (task or userTask)
- `level` — `primary` | `backup` | `training`

### engine_json lanes — extension

Each lane gains an optional `owner_emp_id`. No breaking change — `additionalProperties: True` is already in the schema.

```json
{
  "id": "lane_1",
  "name": "Nákup",
  "owner_emp_id": "uuid"
}
```

### Competency levels

| Level | Meaning |
|---|---|
| `primary` 🟢 | Does this step regularly, main responsible person |
| `backup` 🔵 | Can do it, steps in when primary is absent |
| `training` 🟡 | Currently learning, not yet independent |

### Relationships

```
Employee (1) ──── (N) Competency (N) ──── (1) ProcessStep (engine_json node)
```

One employee has many competencies across many processes.  
One step has many competencies (multiple people, different levels).

---

## Backend

### New files

```
backend/
  services/
    org_employees_storage.py     ← CRUD for employees.json
    org_competencies_storage.py  ← CRUD for competencies.json + matrix generator
  routers/
    org_workforce_router.py      ← API endpoints, prefix /api/workforce
```

### API endpoints

**Employees**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workforce/employees` | List all employees for org |
| `POST` | `/api/workforce/employees` | Create employee `{ emp_no, name, position }` |
| `PATCH` | `/api/workforce/employees/{id}` | Update name / position |
| `DELETE` | `/api/workforce/employees/{id}` | Delete + cascade-delete competencies |

**Competencies**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workforce/competencies` | List, filter by `?process_node_id=` or `?emp_id=` |
| `POST` | `/api/workforce/competencies` | Assign `{ emp_id, process_node_id, step_id, level }` |
| `PATCH` | `/api/workforce/competencies/{id}` | Change level |
| `DELETE` | `/api/workforce/competencies/{id}` | Remove assignment |

**Matrix**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/workforce/matrix` | Full org matrix — all employees × all steps |
| `GET` | `/api/workforce/matrix?process_node_id=X` | Matrix scoped to one process |

Matrix response shape:
```json
{
  "employees": [ { "id": "...", "emp_no": "E001", "name": "Jana K." } ],
  "steps": [ { "step_id": "task_001", "name": "Vytvorenie objednávky", "process_node_id": "...", "process_name": "..." } ],
  "cells": [ { "emp_id": "...", "step_id": "task_001", "level": "primary" } ],
  "risk": [ { "step_id": "task_001", "risk": "none" | "low" | "critical" } ]
}
```

Risk is computed server-side:
- `unassigned` — no one assigned to this step at all
- `critical` — only one person knows this step (single point of failure)
- `low` — at least two people assigned but no primary, or only training
- `none` — at least one primary + at least one backup

### Integration points

- **`main.py`** — register `org_workforce_router` (one line)
- **`engine.py`** — no change needed (`additionalProperties: True` already allows `owner_emp_id` on lanes)
- **Auth** — same `org_id` scope as all other org endpoints, `require_user` dependency

### What does NOT change

- Existing engine_json schema (backwards compatible)
- Existing processes and models
- Storage pattern (JSON files in org directory)
- Auth/permissions system

---

## Frontend

### MapViewer.jsx — overlay toggle

- Toggle button in the map toolbar: "👥 Zastupiteľnosť" (off by default)
- When ON:
  - Each task node gets colored border: 🟢 green = well covered, 🟡 orange = only training/backup, 🔴 red = single point of failure
  - Badges below task name show: `🟢 Jana` `🔵 Eva` etc.
  - Clicking a task opens a side panel
- Side panel:
  - Lists all competency assignments for this step (emp_no + name + level)
  - Inline "change level" dropdown
  - "Add employee" — searchable dropdown with inline-add if emp doesn't exist yet
  - Warning if step has only one person or no backup

### WorkforcePage.jsx — new page

- Accessible from org settings sidebar
- Two tabs:
  1. **Zamestnanci** — table of employees with emp_no, name, position. Add/edit/delete.
  2. **Matica zastupiteľnosti** — full org matrix table. Columns with red header = critical steps. Filter by process.

---

## UX — Risk coloring

| Visual | Risk level | Meaning |
|---|---|---|
| 🟢 Green border | `none` | Primary + at least one backup assigned |
| 🟡 Orange border | `low` | No primary, only backup/training |
| 🔴 Red border + glow | `critical` | Only one person knows this step |
| ⚫ Dark border | `unassigned` | No one assigned yet |

---

## Out of scope

- Linking employees to app user accounts (future)
- Notifications when a critical step has no backup
- Export to Excel
- Skill/certification tracking beyond the 3 levels

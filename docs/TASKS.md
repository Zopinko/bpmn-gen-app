# Tabuľa úloh

Orchestrátor: Claude Code · Vykonávateľ: Codex · Postup: `docs/ORCHESTRATION.md`

## Úlohy

| ID | Názov | Vykonávateľ | Stav | Zadanie |
|---|---|---|---|---|
| T-001 | Senior audit backendu | codex | hotova | [T-001](tasks/T-001.md) |
| T-002 | Senior audit frontendu, konfigurácie a repa | claude | hotova | [frontend-config.md](audit/frontend-config.md) |
| T-003 | Zlúčený audit report | claude | hotova | [AUDIT.md](audit/AUDIT.md) |
| T-004 | Tok nesmie ísť cez krok (H05) | codex | hotova | [T-004](tasks/T-004.md) |
| T-005 | Viewer nesmie zapisovať, invite-link GET bez účinkov (H03, H04) | codex | hotova | [T-005](tasks/T-005.md) |
| T-006 | Zmena hesla odhlási ostatné sessions (H07) | codex | hotova | [T-006](tasks/T-006.md) |
| T-007 | react-router, Suma 1000 (H08), debug endpointy (M05), XML escape (M06), CSRF Origin (H04) | claude | hotova | – |

## Čaká na vlastníka

- ~~`auth.db` v histórii public repa~~ – vyriešené: iba lokálne testovacie účty, prepis netreba.
- ~~Render env~~ – vyriešené: vlastník potvrdil `BPMN_MODELS_DIR` a `AUTH_DB_PATH` pod `/var/bpmn-models`.
- Skupina „Bezpečnosť a správnosť“ hotová (T-004 až T-007), necommitnutá – čaká na súhlas s commitom/PR.
- Zostáva zo skupiny 2: testovací auth bypass (M12), `render.yaml` + verzia Pythonu (V3, S1). Ďalej skupiny 3–6 z `docs/audit/AUDIT.md`.

## Metriky

| Kolo | Úlohy | Vrátené | Konflikty súborov | Zásahy vlastníka | Testy | Nesúlad reportu | Trvanie |
|---|---|---|---|---|---|---|---|
| 2 (opravy) | 4 (3 codex, 1 claude) | 0 (1 úprava orchestrátora v T-005) | 0 | 0 | backend 478/478, lint 0, build OK, node:test 8/8, npm audit 0 | žiadny | ~1,5 h |
| 1 (audit) | 3 (1 codex, 2 claude) | 0 | 0 | 0 | backend 229/229, lint 0, build OK, node:test 8/8 | žiadny (6 nálezov overených, H05 reprodukované) | ~1 h |

# BPMN.GEN – inštrukcie pre agentov

Platia pre Claude Code aj Codex.

## Projekt

- BPMN.GEN: generátor BPMN procesných máp.
- Backend: Python + FastAPI v `backend/` (vstup `backend/main.py`, routery `backend/routers/`, logika `backend/services/` a `backend/core/`, testy `backend/tests/`).
- Frontend: React + Vite v `frontend/`.
- Nasadenie: Render (`render.yaml`). Nenasadzuje sa bez výslovného súhlasu vlastníka.

## Roly

- **Orchestrátor: Claude Code.** Preberá ciele od vlastníka, rozkladá ich na úlohy, deleguje časť Codexu, zvyšok implementuje sám, kontroluje výsledky a reportuje vlastníkovi.
- **Vykonávateľ: Codex.** Robí iba úlohu, ktorú mu orchestrátor pridelí v `docs/tasks/T-XXX.md`. Nedeleguje ďalej, nespúšťa iných agentov, nepreberá iné úlohy.
- Postup, životný cyklus úloh a šablóna zadania sú v `docs/ORCHESTRATION.md`.
- Nepredstieraj prácu druhého agenta. Report nie je dôkaz, overuje sa diff a testy.

## Pravidlá pre všetky úlohy

- Meň iba súbory, ktoré úloha menuje v časti „Povolené cesty“. Dve bežiace úlohy nemenia rovnaké súbory.
- Neprepisuj ani nevracaj cudziu rozpracovanú prácu ani zmeny vlastníka v pracovnom strome.
- Žiadne commity, push, nasadenie, zmeny tajomstiev (`.env`), reálne e-maily ani platené služby bez súhlasu vlastníka.
- Neprehľadávaj `node_modules`, `venv`, `.venv`, `backend/venv`, `.git`, `frontend/dist`, `graphify-out` ani cache priečinky.
- Prostredie je Windows (PowerShell). Používaj `;`, nie `&&`.
- Texty v UI sú v slovenčine a angličtine (i18n). Pri zmene textu uprav oba jazyky.
- Vo vygenerovaných mapách je pár krížení tokov v poriadku, ale tok nikdy nesmie prechádzať cez krok.

## Overenie

Backend testy:

```powershell
cd backend; .\venv\Scripts\python -m pytest -q
```

Frontend:

```powershell
cd frontend; npm run lint; npm run build
```

Spusti testy relevantné pre zmenu a výsledok uveď v reporte presne (prešlo / zlyhalo + výpis).

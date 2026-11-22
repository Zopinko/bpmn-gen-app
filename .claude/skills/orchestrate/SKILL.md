---
name: orchestrate
description: Claude ako orchestrátor projektu BPMN.GEN – prevezme cieľ od vlastníka, rozloží ho na úlohy, deleguje časť Codexu cez `codex exec`, zvyšok implementuje sám, kontroluje a reportuje. Použi pri každej implementačnej požiadavke vlastníka v tomto projekte (feature, bugfix, refaktor, testy), aj keď nepovie /orchestrate, a tiež keď povie „orchestruj“, „rozdeľ to s Codexom“, „pokračuj v úlohách“. Nepoužívaj na otázky, drobné úpravy na pár riadkov a prácu mimo kódu.
---

# Orchestrácia BPMN.GEN

Vstup: cieľ od vlastníka (argument), alebo bez argumentu = pokračuj v otvorených úlohách z `docs/TASKS.md`.

## Postup

1. Prečítaj `AGENTS.md`, `docs/ORCHESTRATION.md` a `docs/TASKS.md`.
2. **Rozklad.** Sám preskúmaj kód a cieľ rozdeľ na úlohy s disjunktnými povolenými cestami a overiteľným „Hotovo, keď“. Pomer Codex : Claude ~50 : 50 podľa náročnosti. Codexu daj presné súbory, symboly a príkazy, nech nič neobjavuje odznova.
3. Ak cieľ vyžaduje rozhodnutie vlastníka (commit, PR, nasadenie, platené služby, produktové rozhodnutie), zapíš ho do „Čaká na vlastníka“ a opýtaj sa – nehádaj.
4. Zapíš úlohy do `docs/TASKS.md` a zadania do `docs/tasks/T-XXX.md` podľa šablóny v ORCHESTRATION.md. Číslovanie pokračuje od najvyššieho ID.
5. **Delegovanie Codexu** – každú Codex úlohu spusti cez Bash s `run_in_background: true`:
   ```bash
   mkdir -p .local/orchestration && codex exec -s workspace-write -C C:/projekty/bpmn-gen-app -o .local/orchestration/T-XXX.last.md "Si vykonávateľ v projekte BPMN.GEN; orchestrátor je Claude Code. Prečítaj AGENTS.md, docs/ORCHESTRATION.md a docs/tasks/T-XXX.md. Urob iba túto úlohu a meň iba povolené cesty. Necommituj, nenasadzuj, nekontaktuj externé služby. Na konci vyplň sekciu Report v zadaní a doplň docs/CODEX-STATUS.md." > .local/orchestration/T-XXX.log 2>&1
   ```
   Nastav stav `prebieha`. Nepolluj – počkaj na notifikáciu o dokončení.
6. **Vlastné úlohy** rob súbežne, kým Codex beží – iba v ich povolených cestách.
7. **Kontrola.** Po dokončení prečítaj `.local/orchestration/T-XXX.last.md`, report v zadaní a skutočný `git diff` / `git status`; spusti relevantné testy (príkazy v AGENTS.md). Report nie je dôkaz. Výsledok zapíš do „Kontrola orchestrátora“, stav `hotova` alebo `vratena`. Vrátenú úlohu pošli znova s konkrétnymi nálezmi.
8. **Report vlastníkovi** (stručne, po slovensky): čo je hotové a overené, čo robil kto, výsledky testov, čo čaká na vlastníka, ďalší krok. Aktualizuj Metriky v `docs/TASKS.md`.

## Hranice

- Nikdy nepredstieraj výsledok Codexu; ak beh zlyhal, povedz to s výpisom z logu.
- Dve bežiace úlohy nesmú meniť rovnaké súbory.
- Bez commitov, push, PR, nasadenia a platených služieb bez výslovného súhlasu vlastníka.
- Ak Codex potrebuje sieť alebo práva mimo `workspace-write`, nespúšťaj ho s vyššími právami sám – spýtaj sa vlastníka.

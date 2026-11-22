# Orchestrácia Claude Code + Codex

Vlastník zadáva prácu orchestrátorovi (Claude Code). Orchestrátor ju rozloží na úlohy, časť deleguje Codexu, zvyšok robí sám, všetko skontroluje a reportuje vlastníkovi.

## Roly

| Rola | Robí | Nerobí |
|---|---|---|
| Vlastník | Zadáva ciele, schvaľuje rozhodnutia, commity, PR, nasadenie | – |
| Orchestrátor (Claude Code) | Rozklad, tabuľa `docs/TASKS.md`, zadania `docs/tasks/T-XXX.md`, delegovanie, vlastná implementácia, kontrola | Nepredstiera prácu Codexu, neschvaľuje za vlastníka |
| Vykonávateľ (Codex) | Pridelenú úlohu implementuje v jej rozsahu, zapíše report | Nemení súbory mimo rozsahu, nedeleguje ďalej |

Pomer práce Codex : Claude približne 50 : 50 podľa náročnosti, ak vlastník neurčí inak.

## Životný cyklus úlohy

`navrh` → `pridelena` → `prebieha` → `na-kontrole` → `hotova` | `vratena` | `blokovana`

1. Orchestrátor zapíše riadok do `docs/TASKS.md` a zadanie do `docs/tasks/T-XXX.md` (šablóna nižšie).
2. Spustí Codex (príkaz nižšie), stav `prebieha`.
3. Codex na konci vyplní sekciu `## Report` v zadaní a doplní `docs/CODEX-STATUS.md`.
4. Orchestrátor overí výsledok sám (diff, testy). Výsledok `hotova` alebo `vratena` s konkrétnymi nálezmi.
5. Rozhodnutia vlastníka idú do sekcie „Čaká na vlastníka“ v `docs/TASKS.md`.

## Spúšťanie Codexu

Beží na pozadí, logy v `.local/orchestration/` (v `.gitignore`):

```bash
mkdir -p .local/orchestration && codex exec -s workspace-write -C C:/projekty/bpmn-gen-app -o .local/orchestration/T-XXX.last.md "Si vykonávateľ v projekte BPMN.GEN; orchestrátor je Claude Code. Prečítaj AGENTS.md, docs/ORCHESTRATION.md a docs/tasks/T-XXX.md. Urob iba túto úlohu a meň iba povolené cesty. Necommituj, nenasadzuj, nekontaktuj externé služby. Na konci vyplň sekciu Report v zadaní a doplň docs/CODEX-STATUS.md." > .local/orchestration/T-XXX.log 2>&1
```

Vrátenie úlohy: `codex exec resume --last "<nálezy>"` alebo nové spustenie s nálezmi v zadaní.

Súbežne smú bežať iba úlohy s disjunktnými povolenými cestami.

## Šablóna zadania `docs/tasks/T-XXX.md`

```markdown
# T-XXX: <názov>

Vykonávateľ: codex | claude
Stav: pridelena
Závisí od: –

## Cieľ
<jedna-dve vety>

## Kontext
<súbory, funkcie, symboly, ktoré orchestrátor už pozná>

## Povolené cesty
- <presné súbory/priečinky>

## Zakázané
- Commity, nasadenie, tajomstvá, reálne e-maily, súbory mimo povolených ciest.

## Hotovo, keď
- <overiteľné kritérium, ideálne príkaz testu a očakávaný výsledok>

## Report
<vyplní vykonávateľ: zmeny, spustené testy s výsledkom, limity, otvorené otázky>

## Kontrola orchestrátora
<vyplní orchestrátor>

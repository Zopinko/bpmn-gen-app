# BPMN Generator

Monorepo obsahuje backend aj frontend v jednom repozitari:

- backend/ - FastAPI aplikacia
- frontend/ - React/Vite klient
- data/ - miesto pre modely alebo vystupy (zatial prazdne)

## Lokalny beh

### Backend
1. `cd backend`
2. (volitelne) aktivuj virtualne prostredie
3. `pip install -r requirements.txt`
4. `uvicorn main:app --reload`

### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`

Po presune povodnych priecinkov ostali stare kopie v `bpmn-gen` a `bpmn-gen-frontend`; prestali sme ich pouzivat a mozes ich pripadne zmazat po zatvoreni procesov, ktore ich drzia otvorene.

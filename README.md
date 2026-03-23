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

## Render Deploy

Repo je pripravene na Render cez [render.yaml](C:/projekty/bpmn-gen-app/render.yaml):

- `bpmngen-api`: Python web service z `backend/`
- `bpmngen-web`: static site z `frontend/`

Minimal production env vars pre backend:

- `APP_ENV=production`
- `ORG_INVITE_TOKEN_SECRET`
- `AUTH_EMAIL_PROVIDER=smtp`
- `AUTH_EMAIL_FROM`
- `AUTH_EMAIL_SMTP_HOST`
- `AUTH_EMAIL_SMTP_PORT`
- `AUTH_EMAIL_SMTP_SECURITY`
- `AUTH_EMAIL_SMTP_USERNAME`
- `AUTH_EMAIL_SMTP_PASSWORD`
- `CORS_ALLOW_ORIGINS`
- `PASSWORD_RESET_URL_BASE`
- `SESSION_COOKIE_DOMAIN` podľa produkčnej domény
- `AUTH_DB_PATH=/var/data/auth.db` pri Render disk mount

Poznámka:

- `ORG_INVITE_TOKEN_SECRET`, `CORS_ALLOW_ORIGINS`, `PASSWORD_RESET_URL_BASE` a `AUTH_DB_PATH` sú v produkcii fail-fast required. Ak chýbajú, backend sa má zastaviť namiesto tichého fallbacku.
- `AUTH_EMAIL_ALLOWLIST` je voliteľný CSV zoznam emailov pre bezpečný rollout. Kým je nastavený, reset emaily odídu len na tieto adresy.

Minimal production env vars pre frontend:

- `VITE_API_BASE=https://<tvoja-backend-render-domena>`

Poznámky pre produkciu:

- `data/auth.db` a iné lokálne DB artefakty nemajú byť commitované.
- Backend počíta s perzistentným diskom pre auth DB; bez neho bude Render filesystem ephemerálny.
- Frontend build je zelený, ale stále hlási veľký JS chunk; to je performance dlh, nie deploy blocker.

### Render Production Checklist

Backend service `bpmngen-api`:

1. `Root Directory`: `backend`
2. `Build Command`: `pip install --upgrade pip && pip install -r requirements.txt`
3. `Start Command`: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. `Health Check Path`: `/healthz`
5. Pripoj persistent disk na `/var/data`
6. Nastav `AUTH_DB_PATH=/var/data/auth.db`
7. Nastav `APP_ENV=production`
8. Nastav silný `ORG_INVITE_TOKEN_SECRET`
9. Nastav `AUTH_EMAIL_PROVIDER=smtp`
10. Nastav `AUTH_EMAIL_FROM=<mailbox@tvoja-domena>`
11. Nastav `AUTH_EMAIL_SMTP_HOST=smtp.m1.websupport.sk`
12. Nastav `AUTH_EMAIL_SMTP_PORT=587` pre TLS alebo `465` pre SSL
13. Nastav `AUTH_EMAIL_SMTP_SECURITY=starttls` pre port `587` alebo `ssl` pre port `465`
14. Nastav `AUTH_EMAIL_SMTP_USERNAME=<mailbox@tvoja-domena>`
15. Nastav `AUTH_EMAIL_SMTP_PASSWORD=<heslo-mailovej-schranky>`
16. Pri prvom rollout-e voliteľne nastav `AUTH_EMAIL_ALLOWLIST=<tvoj-email>,<druhy-test-email>`
17. Nastav `PASSWORD_RESET_URL_BASE=https://<frontend-domena>/reset-password`
18. Nastav `CORS_ALLOW_ORIGINS=https://<frontend-domena>` alebo CSV zoznam produkčných frontend domén
19. Nastav `SESSION_COOKIE_DOMAIN=<frontend-domena-bez-protocolu>` len ak chceš cookie viazať na konkrétnu doménu

Frontend service `bpmngen-web`:

1. `Root Directory`: `frontend`
2. `Build Command`: `npm ci && npm run build`
3. `Publish Directory`: `dist`
4. Nastav `VITE_API_BASE=https://<backend-render-domena>`

Post-deploy smoke checks:

1. `GET https://<backend-render-domena>/healthz` vracia `200` a `{"status":"ok"}`
2. Frontend vie načítať app bez `CORS` chýb v browser console
3. Login / session cookie funguje v produkcii
4. Password reset link smeruje na správnu frontend URL
5. Org invite flow nepadá na chýbajúcom `ORG_INVITE_TOKEN_SECRET`
6. Password reset email príde na test mailbox
7. Ak je zapnutý `AUTH_EMAIL_ALLOWLIST`, email neodíde mimo allowlist

### Websupport SMTP

Podľa oficiálnej podpory Websupport:

- SMTP host je `smtp.m1.websupport.sk`
- port `465` používa SSL
- port `587` používa TLS
- po prihlásení vieš odosielať len z adries pod rovnakou doménou, ku ktorej patrí mailbox

Zdroje:

- Websupport SMTP protokoly: https://www.websupport.sk/podpora/kb/postove-protokoly/
- Render free SMTP obmedzenie: https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports

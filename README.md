# Klarify Backend

Node.js/Express backend voor Klarify. Beheert Stripe-abonnementen en proxyt veilig de Anthropic API.

## Architectuur

```
Browser (klarify.html)
    ↕  JWT token
Klarify Backend (deze server)
    ↕  Anthropic API key (geheim)      ↕  Stripe secret key (geheim)
Anthropic API                          Stripe
```

De API-sleutels staan **nooit** in de browser — alleen op deze server.

---

## Lokaal draaien

```bash
# 1. Dependencies installeren
npm install

# 2. Environment variabelen instellen
cp .env.example .env
# Vul .env in met uw sleutels (zie hieronder)

# 3. Starten
npm run dev
```

Server draait op http://localhost:3000

---

## Stripe instellen

### 1. Account aanmaken
Ga naar [dashboard.stripe.com](https://dashboard.stripe.com) en maak een account aan.

### 2. Product aanmaken
- Dashboard → Products → + Add product
- Naam: `Klarify Pro`
- Prijs: `€7,99` per maand (recurring)
- Kopieer de **Price ID** (`price_...`) → zet in `.env` als `STRIPE_PRICE_ID`

### 3. API sleutels
- Dashboard → Developers → API keys
- Kopieer **Secret key** (`sk_live_...`) → `STRIPE_SECRET_KEY` in `.env`
- Gebruik `sk_test_...` voor testen

### 4. Webhook instellen
- Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://uw-domein.com/webhook`
- Events selecteren:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Kopieer **Webhook signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET` in `.env`

### 5. iDEAL activeren (voor Nederlandse gebruikers)
- Dashboard → Settings → Payment methods → iDEAL → Activeren

---

## Deployen op Railway (aanbevolen, gratis te starten)

```bash
# 1. Railway CLI installeren
npm install -g @railway/cli

# 2. Inloggen
railway login

# 3. Project aanmaken
railway init

# 4. Deployen
railway up

# 5. Environment variabelen instellen
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set STRIPE_SECRET_KEY=sk_live_...
railway variables set STRIPE_WEBHOOK_SECRET=whsec_...
railway variables set STRIPE_PRICE_ID=price_...
railway variables set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
railway variables set GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
railway variables set ALLOWED_ORIGIN=https://uw-domein.com

# 6. Domein ophalen
railway domain
```

Kopieer het Railway-domein en zet het als webhook URL in Stripe.

---

## Deployen op Render (alternatief)

1. Ga naar [render.com](https://render.com) → New → Web Service
2. Verbind uw GitHub repository
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Voeg Environment Variables toe (zie .env.example)

---

## Frontend aanpassen

In `klarify.html` moet u de backend URL instellen.
Zoek naar deze regel bovenin het `<script>` blok:

```javascript
const BACKEND_URL = 'https://uw-railway-domein.up.railway.app';
```

Vervang dit met uw daadwerkelijke backend URL.

---

## API endpoints

| Method | Endpoint | Auth | Beschrijving |
|--------|----------|------|-------------|
| POST | `/api/auth/google` | — | Google login, geeft JWT terug |
| GET | `/api/auth/me` | JWT | Huidige gebruikersstatus |
| POST | `/api/subscription/checkout` | JWT | Stripe Checkout URL ophalen |
| POST | `/api/subscription/portal` | JWT | Abonnement beheren |
| GET | `/api/subscription/status` | JWT | Abonnementsstatus |
| POST | `/api/analyse/ocr` | JWT + sub | Afbeelding OCR |
| POST | `/api/analyse/document` | JWT + sub | Document analyse |
| POST | `/webhook` | Stripe sig | Stripe events |
| GET | `/health` | — | Healthcheck |

---

## Abonnementsmodel

- **3 gratis analyses** voor nieuwe gebruikers (geen abonnement nodig)
- **€7,99/maand** voor onbeperkte analyses
- **14 dagen gratis proefperiode** via Stripe trial
- Betaling via creditcard of iDEAL

---

## Database (productie)

De huidige `users.js` slaat data op in het geheugen — dit verliest alles bij herstart.
Voor productie: vervang de Map met SQLite of PostgreSQL.

**SQLite (eenvoudigst):**
```bash
npm install better-sqlite3
```

**PostgreSQL (via Railway):**
- Railway → Add Service → PostgreSQL
- Voeg `DATABASE_URL` toe aan environment variables

---

## Veiligheid checklist

- [x] API sleutels nooit in browser
- [x] JWT tokens voor authenticatie
- [x] Rate limiting (60 requests/15 min per IP)
- [x] Stripe webhook signature verificatie
- [x] Google token verificatie server-side
- [x] CORS beperkt tot uw domein
- [ ] HTTPS verplicht (Railway/Render regelen dit automatisch)
- [ ] Database backup instellen

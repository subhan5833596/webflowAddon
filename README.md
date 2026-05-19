# CentreBlock for Webflow — Complete Setup

3 parts hain:

```
centreblock-webflow/
├── broker/      ← Node.js backend (secrets store + token broker)
├── tracker/     ← tracker.js (visitor browser mein chalega)
└── extension/   ← Webflow Designer Extension (Webflow Designer mein chalega)
```

Hum yeh karenge:
1. Broker chalayenge (local)
2. Broker ko internet pe expose karenge (ngrok)
3. Extension build karenge → `bundle.zip` banayenge
4. Webflow pe app register karenge (yahan redirect URI ki problem solve karenge)
5. `bundle.zip` Webflow pe upload karenge
6. Webflow site pe test karenge

---

## Pehle requirements

- **Node.js 18+** install hona chahiye → `node --version`
- **ngrok** account aur installed → https://ngrok.com/download (free account chalega)
- **Webflow account** mein **2FA enable** hona chahiye (zaroori hai warna bundle upload nahi hoga)
- Webflow Workspace mein **admin access**

---

## Step 1 — Broker chalao

```bash
cd broker
npm install
cp .env.example .env
```

`.env` file kholo. `ENCRYPTION_KEY` generate karo:

```bash
# Mac / Linux / WSL:
openssl rand -hex 32

# Output ko .env mein ENCRYPTION_KEY= ke aage paste karo
```

Phir broker start karo:

```bash
npm run dev
```

Yeh dikhna chahiye:

```
╔══════════════════════════════════════════════╗
║  CentreBlock Broker running on port 4000     ║
║  Debug:    ON                                ║
║  CB API:   https://prod.centreblock.net/api/v1/║
╚══════════════════════════════════════════════╝
```

**Test:**
```bash
curl http://localhost:4000/health
# {"ok":true,"time":"..."}

curl http://localhost:4000/tracker.js
# tracker.js ka pura code dikhna chahiye
```

✅ Broker chal raha hai. **Yeh terminal khula chodo.**

---

## Step 2 — Broker ko internet pe expose karo (ngrok)

Webflow extension `localhost:4000` ko pohonch nahi sakti. Public URL chahiye.

**Naya terminal** kholo:

```bash
ngrok http 4000
```

Yeh aisa dikhega:

```
Forwarding   https://ab12-34-56-78.ngrok-free.app -> http://localhost:4000
```

Woh `https://...ngrok-free.app` URL **copy kar lo** — yeh tumhara public broker URL hai.

**Test:**
```bash
curl https://ab12-34-56-78.ngrok-free.app/health
# {"ok":true,...}
```

✅ Broker ab internet pe accessible hai. **Ngrok terminal bhi khula chodo.**

---

## Step 3 — Extension build karke `bundle.zip` banao

**Naya terminal** kholo:

```bash
cd extension
npm install
npm run build
```

`npm run build` yeh teen kaam karega:
1. Dependencies install karega
2. TypeScript compile karega (`src/index.ts` → `public/index.js`)
3. Webflow CLI bundle banayega → **`bundle.zip`** root mein

Aakhir mein dikhega:
```
Packaging the contents of the public folder into bundle.zip...
4316 total bytes written
Done! bundle.zip is ready for you to upload to your Webflow app.
```

`bundle.zip` `extension/` folder mein ban gayi hai. Verify:

```bash
ls -la bundle.zip
unzip -l bundle.zip   # andar ki files dekho
```

Should show: `webflow.json`, `index.html`, `index.js`, `styles.css`

✅ Bundle ready hai.

---

## Step 4 — Webflow pe App register karo

### 4.1 — Workspace settings kholo

1. Webflow Dashboard kholo
2. Top right mein **Workspace** select karo
3. **Workspace Settings** → left sidebar mein **Apps & Integrations**
4. Tab: **Develop** click karo
5. **Create new App** button click karo

### 4.2 — App form fill karo

| Field | Kya daalo |
|---|---|
| **App name** | CentreBlock |
| **App description** | Visitor activity tracking for CentreBlock |
| **Homepage URL** | `https://centreblock.net` (ya jo bhi ho) |
| **App icon** | Koi PNG upload karo (256x256 recommended) |

### 4.3 — Building Blocks — **YAHAN DHYAN DENA**

Yeh sabse important step hai. Aage 2 boxes dikhenge:

- ☐ **Data Client** ← **mat select karo**
- ☑ **Designer Extension** ← **sirf yeh select karo**

**Designer Extension select karne se redirect URI field gayab ho jayegi** — kyunki redirect URI sirf OAuth (Data Client) ke liye chahiye.

> **Agar phir bhi "Redirect URI" field dikhe** (kuch versions mein dikhati hai), to yeh daal do:
> `http://localhost:4000/oauth/callback`
> Designer Extension only ke liye yeh field actually use nahi hoti, par form ko submit karne ke liye kuch bharna padta hai.

### 4.4 — Scopes (Permissions)

Sirf yeh tick karo:
- ☑ `sites:read` — site ka name aur ID padhne ke liye

Baaki sab unchecked rakho. Hum **abhi** Custom Code API use nahi kar rahe (woh Data Client wale Hybrid app ke liye chahiye hota hai).

### 4.5 — **Create App** click karo

✅ App register ho gayi.

App settings mein ab yeh dikhega:
- **Client ID** — abhi zaroorat nahi
- **Client Secret** — abhi zaroorat nahi
- **Publish extension version** button — **yeh use karenge agle step mein**

---

## Step 5 — `bundle.zip` upload karo

Apni newly created app ke screen pe:

1. **"..."** menu (right side) → **"Publish extension version"** click karo
2. File picker khulega → `extension/bundle.zip` select karo
3. Version notes mein likho: `v1.0 initial`
4. **Upload** click karo

Agar 2FA enable nahi hai to upload button disabled hoga. Webflow account settings mein 2FA on karo.

Upload ke baad: ✅ "Extension uploaded successfully"

---

## Step 6 — App install karo (apni test site pe)

1. App settings mein **"..."** menu → **"Install App"**
2. Site select karo jahan test karna hai
3. **Authorize & Install** click karo

Ab app installed hai.

---

## Step 7 — Webflow Designer mein extension chalao

1. Apni Webflow site Designer mein kholo
2. Left sidebar mein **"E"** key dabao (ya **Apps** icon click karo)
3. **CentreBlock** dikhega
4. Do options honge:
   - **Launch development app** — local dev URL se chalata hai (Step 8 mein use karenge)
   - **Launch App** — uploaded bundle se chalata hai → **abhi yeh click karo**

CentreBlock panel khulega Designer ke andar.

---

## Step 8 — Extension configure karo

Panel mein:

1. **Broker URL** — Step 2 wala ngrok URL paste karo
   Example: `https://ab12-34-56-78.ngrok-free.app`
2. **Test Broker Connection** click karo → "✓ Broker reachable" dikhna chahiye
3. **CentreBlock Secret** — CentreBlock dashboard se jo secret mila woh paste karo
4. **Default Audience** → `default`
5. **Debug** → `On` (testing ke liye)
6. **Save & Generate Snippet** click karo

Snippet automatically clipboard mein copy ho jayegi. Aur panel mein bhi dikhegi:

```html
<script>
window.__CENTREBLOCK_CONFIG__ = {
  siteId: "abc123...",
  brokerUrl: "https://ab12-34-56-78.ngrok-free.app",
  audience: "default",
  debug: true,
  webname: "mysite"
};
</script>
<script src="https://ab12-34-56-78.ngrok-free.app/tracker.js" defer></script>
```

**Notice:** Snippet mein **secret nahi hai**. Sirf `siteId` aur `brokerUrl`.

---

## Step 9 — Snippet ko Webflow site pe paste karo

Webflow Designer mein:

1. **Site Settings** (gear icon, top-left)
2. **Custom Code** tab
3. **Footer Code** section mein clipboard se paste karo (Ctrl+V / Cmd+V)
4. **Save Changes** click karo
5. **Publish** site (top-right ka publish button)

⚠️ **Custom code sirf published site pe chalti hai, Designer preview mein nahi.**

---

## Step 10 — Test karo

Published Webflow URL kholo (e.g. `yoursite.webflow.io`).

Browser DevTools kholo (**F12** → Console tab).

Yeh logs dikhne chahiye (kyunki `debug: true` hai):

```
[CB-Tracker] booting with config {siteId: "abc...", brokerUrl: "...", debug: true}
[CB-Tracker] ✓ got token eyJhbGc...
[CB-Tracker] trigger mysite__page_PAGE → 201 {page: "Home", direction: "Neutral"}
[CB-Tracker] click tracking attached
```

Kisi button/link pe click karo:
```
[CB-Tracker] trigger mysite__signup_button_button → 201 {direction: "Positive", ...}
```

Broker terminal mein bhi dekho:
```
[BROKER] → POST /token { site_id: 'abc123...' }
[BROKER] token mint for abc123: 200
[BROKER] → POST /trigger/mysite__page_PAGE
[BROKER] trigger mysite__page_PAGE: 201
```

✅ **Working!**

---

# Local Development Mode (`npm run dev`)

Jab bhi extension code change karo aur dobara `bundle.zip` upload na karna ho:

```bash
cd extension
npm run dev
```

Yeh extension ko `http://localhost:1337` pe serve karega.

Phir Webflow Designer mein:
- Apps panel kholo → CentreBlock
- **"Launch development app"** click karo (na ke "Launch App")

Code change karo → save → Designer mein refresh button (top-right corner of panel) click karo → instant reload.

Jab ready ho production ke liye → `npm run build` → naya `bundle.zip` upload karo.

---

# Debugging — Common Problems

### Problem: `npm run build` ke time error
**Check:**
- `node --version` 18+ hai?
- `cd extension` mein ho?
- `npm install` pehle chala?

### Problem: `bundle.zip` upload ke time button disabled hai
**Fix:** Webflow account settings → **Security** → 2FA enable karo. Webflow ne 2FA mandatory rakha hai bundle uploads ke liye.

### Problem: "Launch App" click karne pe extension load nahi hota
**Check:**
- Bundle properly upload hua? (App settings mein "Version history" check karo)
- App installed hai apni site pe? (Step 6)
- Browser cache clear karke refresh karo

### Problem: "Test Broker Connection" fail ho raha
**Check:**
- Broker terminal mein chal raha hai?
- ngrok terminal mein chal raha hai?
- Broker URL end mein `/` lagaya to hata do
- Pura URL HTTPS hai aur ngrok-free.app pe khatam ho raha?
- Manually `curl <ngrok-url>/health` chala ke dekho

### Problem: Token mint pe 403 / 401 error
**Matlab:** Broker tak request pohonchi, par CentreBlock ne reject kiya.
**Check:**
- Customer secret sahi paste hua? Spaces toh nahi end mein?
- Secret CentreBlock dashboard mein abhi valid hai?
- Broker terminal mein full error log dekho

### Problem: Trigger pe 404
**Matlab:** Variable name CentreBlock mein register nahi hai.
**Fix:** CentreBlock dashboard mein woh variable pehle create karo `{webname_page_element_elementtype}` format mein.

### Problem: CORS error browser console mein
**Check:** Broker mein `cors({ origin: true })` enabled hai pehle se. Agar phir bhi aaye:
- Broker restart karo
- ngrok URL change toh nahi ho gaya? Free ngrok restart pe URL change hota hai

### Problem: tracker.js load hi nahi ho raha
**Check:**
- Site **publish** kiya? Custom code sirf published site pe chalti hai
- View Page Source mein `__CENTREBLOCK_CONFIG__` aur script tag dikh rahe?
- Network tab mein `tracker.js` ka response status check karo

### Problem: Clicks track nahi ho rahe
**Check:**
- Console mein `[CB-Tracker] click tracking attached` aaya?
- Element selectable hai? (`<a>`, `<button>`, ya `data-cb-track` attribute)

### Manual test browser console se:
```js
// Browser console mein:
CentreBlock.fireTrigger('test_variable', { page: 'manual_test', direction: 'Positive' });

// Token manually mint karna:
CentreBlock.getToken().then(t => console.log('token:', t));
```

---

# All Commands at a Glance

```bash
# Terminal 1: Broker
cd broker
npm install
cp .env.example .env
# .env mein ENCRYPTION_KEY bharo (openssl rand -hex 32)
npm run dev

# Terminal 2: ngrok
ngrok http 4000
# Public URL copy karo

# Terminal 3: Extension (build for production)
cd extension
npm install
npm run build
# extension/bundle.zip → upload to Webflow

# OR for development (live reload):
npm run dev
# Designer mein "Launch development app" click karo
```

---

# Production Checklist (jab live deploy karna ho)

- [ ] Broker proper hosting pe deploy karo (Railway / Render / Fly.io / VPS)
- [ ] `ENCRYPTION_KEY` proper secrets manager mein rakho
- [ ] Storage: JSON file ko Postgres ya SQLite se replace karo
- [ ] HTTPS lagao (Cloudflare ya hosting provider se)
- [ ] CORS `origin: true` ki jagah specific allowed domains do
- [ ] Rate limiting add karo (`express-rate-limit`)
- [ ] Logs rotation aur monitoring setup karo
- [ ] Extension Marketplace pe submit karo (review 3–7 din)

---

# Final File Structure

```
centreblock-webflow/
├── broker/
│   ├── server.js          ← Node.js broker
│   ├── package.json
│   ├── .env.example
│   └── .env               ← (tum banaoge, gitignored)
├── tracker/
│   └── tracker.js         ← visitor browser script
├── extension/
│   ├── webflow.json       ← Webflow manifest
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore
│   ├── src/
│   │   └── index.ts       ← extension logic (TypeScript)
│   ├── public/
│   │   ├── index.html     ← extension UI
│   │   ├── styles.css
│   │   └── index.js       ← (auto-generated by tsc, gitignored)
│   └── bundle.zip         ← (auto-generated, upload this)
└── README.md
```

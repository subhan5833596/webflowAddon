# CentreBlock Webflow Integration

Production broker hosted on Azure Functions, integrated with the CentreBlock SaaS for visitor tracking on Webflow sites.

## Architecture

```
Visitor browser ──► tracker.js ──► Azure Function broker ──► CentreBlock API
                                          │
                                          └──► Azure Table Storage (sites)
```

## Structure

```
broker/         Azure Function App (Node.js 22, v4 model)
  src/
    functions/  Each endpoint = separate file
    lib/        Storage, crypto, CB API helpers
  host.json
  package.json
tracker/        Visitor-side tracker.js (loaded on Webflow sites)
extension/      Webflow Designer Extension (TypeScript)
.github/
  workflows/    Auto-deploy on push to master
```

## Function App Settings (Azure portal)

Required environment variables:

| Name | Value |
|---|---|
| `STORAGE_CONNECTION_STRING` | Connection string from sites-table storage account |
| `ENCRYPTION_KEY` | 64-char hex (generate with `openssl rand -hex 32`) |
| `CENTREBLOCK_API` | `https://prod.centreblock.net/api/v1/` |
| `DEBUG` | `true` |

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | /api/health | Health check |
| POST | /api/register | Register site with broker |
| POST | /api/token | Mint CB consumer token for visitor |
| POST | /api/trigger/{name} | Forward trigger event |
| GET | /api/sites | List registered sites |
| POST | /api/variable | Create CB variable |
| GET | /api/variables/{site_id} | List CB variables |
| GET | /api/variable/exists/{site_id}/{name} | Check existence |
| POST | /api/validate/{site_id} | Full integration health check |
| GET | /api/tracker.js | Serve tracker.js |

## Deployment

Push to `master` branch → GitHub Actions auto-deploys to Azure Function App `cb-webflow-broker`.

## Local development

```bash
cd broker
npm install
# Configure local.settings.json with real values
func start
```

Endpoints become available at `http://localhost:7071/api/*`.

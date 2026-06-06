const { app } = require("@azure/functions");
const { encrypt } = require("../lib/crypto");
const { upsertSite } = require("../lib/storage");
const { jsonResponse, corsHeaders } = require("../lib/cbApi");

app.http("register", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "register",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const body = await request.json();
      const {
        site_id,
        secret,
        customer_id,
        domain,
        default_audience = "default",
        debug = false,
        environment = "prod",
      } = body;

      if (!site_id || !secret || !customer_id) {
        return jsonResponse(400, {
          error: "site_id, secret and customer_id are required",
        });
      }

      const encrypted = encrypt(secret);
      await upsertSite(site_id, {
        encrypted_secret: encrypted,
        customer_id,
        domain: domain || "",
        default_audience,
        debug,
        environment,
        created_at: new Date().toISOString(),
      });

      context.log(`✓ registered site ${site_id} (customer: ${customer_id}, env: ${environment})`);
      return jsonResponse(200, { ok: true, site_id });
    } catch (err) {
      context.log.error("register failed:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  },
});

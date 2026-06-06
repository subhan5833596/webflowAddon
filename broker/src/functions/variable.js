const { app } = require("@azure/functions");
const { decrypt } = require("../lib/crypto");
const { getSite } = require("../lib/storage");
const {
  sanitizeTag,
  sanitizeVariableName,
  cbCreateVariable,
  cbGetCsv,
  parseCsv,
  jsonResponse,
  corsHeaders,
} = require("../lib/cbApi");

app.http("variable", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "variable",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const body = await request.json();
      const {
        site_id,
        name,
        weight_for_customer = 50,
        weight_for_default = 50,
        label = "",
        leaving_link = "",
        skip_if_exists = true,
      } = body;

      if (!site_id || !name) {
        return jsonResponse(400, { error: "site_id and name are required" });
      }

      const row = await getSite(site_id);
      if (!row) return jsonResponse(404, { error: "site_id not registered" });

      const cleanName = sanitizeVariableName(name);
      const secret = decrypt(row.encrypted_secret);

      // Skip-if-exists logic — protect historical data
      if (skip_if_exists) {
        try {
          const csvResult = await cbGetCsv(secret, row.customer_id);
          if (csvResult.ok) {
            const variables = parseCsv(csvResult.text);
            const exists = variables.some(
              (v) => (v.name || "").toLowerCase() === cleanName
            );
            if (exists) {
              context.log(`✓ variable "${cleanName}" exists — skipping`);
              return jsonResponse(200, {
                skipped: true,
                name: cleanName,
                message: "Variable already exists — preserved",
              });
            }
          }
        } catch (e) {
          context.log(`csv check failed: ${e.message} — proceeding to create`);
        }
      }

      const variableTags = {};
      if (label) variableTags.label = sanitizeTag(label);

      const payload = {
        name: cleanName,
        categories: {
          customer: Number(weight_for_customer),
          default: Number(weight_for_default),
        },
        tags: variableTags,
      };
      if (leaving_link) payload.leavingLink = leaving_link;

      const result = await cbCreateVariable(secret, payload);
      if (!result.ok) {
        return jsonResponse(result.status, {
          error: "CentreBlock rejected variable creation",
          detail: result.data,
        });
      }

      return jsonResponse(200, {
        created: true,
        name: cleanName,
        cb_response: result.data,
      });
    } catch (err) {
      return jsonResponse(500, { error: err.message });
    }
  },
});

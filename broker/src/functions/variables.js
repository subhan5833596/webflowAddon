const { app } = require("@azure/functions");
const { decrypt } = require("../lib/crypto");
const { getSite } = require("../lib/storage");
const { cbGetCsv, parseCsv, jsonResponse, corsHeaders } = require("../lib/cbApi");

app.http("variables", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "variables/{site_id}",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const site_id = request.params.site_id;
      const row = await getSite(site_id);
      if (!row) return jsonResponse(404, { error: "site_id not registered" });

      const secret = decrypt(row.encrypted_secret);
      const csvResult = await cbGetCsv(secret, row.customer_id);

      if (!csvResult.ok) {
        return jsonResponse(csvResult.status, {
          error: "CentreBlock csv fetch failed",
          detail: csvResult.text,
        });
      }

      const variables = parseCsv(csvResult.text);
      context.log(`listed ${variables.length} variables for ${site_id}`);
      return jsonResponse(200, { variables });
    } catch (err) {
      return jsonResponse(500, { error: err.message });
    }
  },
});

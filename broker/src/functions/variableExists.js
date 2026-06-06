const { app } = require("@azure/functions");
const { decrypt } = require("../lib/crypto");
const { getSite } = require("../lib/storage");
const {
  sanitizeVariableName,
  cbGetCsv,
  parseCsv,
  jsonResponse,
  corsHeaders,
} = require("../lib/cbApi");

app.http("variableExists", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "variable/exists/{site_id}/{variableName}",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const { site_id, variableName } = request.params;
      const row = await getSite(site_id);
      if (!row) return jsonResponse(404, { error: "site_id not registered" });

      const secret = decrypt(row.encrypted_secret);
      const cleanName = sanitizeVariableName(variableName);
      const csvResult = await cbGetCsv(secret, row.customer_id);

      if (!csvResult.ok) {
        return jsonResponse(csvResult.status, {
          error: "CentreBlock csv fetch failed",
          detail: csvResult.text,
        });
      }

      const variables = parseCsv(csvResult.text);
      const exists = variables.some(
        (v) => (v.name || "").toLowerCase() === cleanName
      );

      return jsonResponse(200, { exists, name: cleanName });
    } catch (err) {
      return jsonResponse(500, { error: err.message });
    }
  },
});

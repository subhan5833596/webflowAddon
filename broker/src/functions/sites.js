const { app } = require("@azure/functions");
const { listSites } = require("../lib/storage");
const { jsonResponse, corsHeaders } = require("../lib/cbApi");

app.http("sites", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "sites",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const sites = await listSites();
      return jsonResponse(200, sites);
    } catch (err) {
      return jsonResponse(500, { error: err.message });
    }
  },
});

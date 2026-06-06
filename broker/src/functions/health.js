const { app } = require("@azure/functions");
const { jsonResponse, corsHeaders } = require("../lib/cbApi");

app.http("health", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "health",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    return jsonResponse(200, { ok: true, time: new Date().toISOString() });
  },
});

const { app } = require("@azure/functions");
const { cbTrigger, jsonResponse, corsHeaders, textResponse } = require("../lib/cbApi");

app.http("trigger", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "trigger/{variableName}",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const variableName = request.params.variableName;
      let token = request.headers.get("x-cb-token") || request.query.get("token");
      let body;

      const contentType = (request.headers.get("content-type") || "").toLowerCase();

      if (contentType.includes("text/plain")) {
        // sendBeacon path — text/plain body with JSON inside
        const raw = await request.text();
        try {
          const parsed = JSON.parse(raw);
          if (parsed.token) token = parsed.token;
          body = { tags: parsed.tags || {} };
        } catch (e) {
          return jsonResponse(400, { error: "invalid JSON in text body" });
        }
      } else {
        // Normal JSON
        body = await request.json().catch(() => ({}));
      }

      if (!token) return jsonResponse(400, { error: "token required" });

      const result = await cbTrigger(token, variableName, body);
      context.log(`trigger ${variableName}: ${result.status}`);

      return textResponse(result.status, "text/plain", result.text);
    } catch (err) {
      context.log.error("trigger forward failed:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  },
});

const { app } = require("@azure/functions");
const { decrypt } = require("../lib/crypto");
const { getSite } = require("../lib/storage");
const {
  getClientIp,
  sanitizeTag,
  cbConsumer,
  jsonResponse,
  corsHeaders,
} = require("../lib/cbApi");

app.http("token", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "token",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    try {
      const body = await request.json();
      const { site_id, audiences, tags, token_ttl } = body;

      if (!site_id) return jsonResponse(400, { error: "site_id required" });

      const row = await getSite(site_id);
      if (!row) return jsonResponse(404, { error: "site_id not registered" });

      const visitorIp = getClientIp(request);
      context.log(`visitor IP: ${visitorIp}`);

      const secret = decrypt(row.encrypted_secret);
      const useAudiences =
        Array.isArray(audiences) && audiences.length
          ? audiences
          : [row.default_audience || "default"];

      const rawTags = tags || {};
      const cleanTags = {};
      for (const [k, v] of Object.entries(rawTags)) {
        const ck = sanitizeTag(k);
        const cv = sanitizeTag(v);
        if (ck && cv) cleanTags[ck] = cv;
      }

      const payload = {
        uuid: visitorIp,
        customerId: row.customer_id,
        createdAt: new Date().toISOString(),
        audiences: useAudiences,
        tokenTimeToLive: token_ttl || 10,
        tags: cleanTags,
      };

      const result = await cbConsumer(secret, payload);
      if (!result.ok) {
        return jsonResponse(result.status, {
          error: "CentreBlock rejected",
          detail: result.data,
        });
      }

      return jsonResponse(200, {
        token: result.data.data,
        audiences: useAudiences,
        uuid: visitorIp,
      });
    } catch (err) {
      context.log.error("token mint failed:", err.message);
      return jsonResponse(500, { error: err.message });
    }
  },
});

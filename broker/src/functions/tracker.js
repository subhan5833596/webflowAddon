const { app } = require("@azure/functions");
const fs = require("fs");
const path = require("path");
const { corsHeaders } = require("../lib/cbApi");

// Cache the tracker file in memory at function init
let cachedTracker = null;
function loadTracker() {
  if (cachedTracker) return cachedTracker;
  // tracker.js sits in repo root /tracker/tracker.js
  // From src/functions/ we go up 3 levels: ../../../tracker/tracker.js
  const trackerPath = path.join(__dirname, "..", "..", "..", "tracker", "tracker.js");
  try {
    cachedTracker = fs.readFileSync(trackerPath, "utf8");
    return cachedTracker;
  } catch (err) {
    return null;
  }
}

app.http("tracker", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "tracker.js",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }
    const content = loadTracker();
    if (!content) {
      return {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "// tracker.js not found",
      };
    }
    return {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=300", // 5 min cache
      },
      body: content,
    };
  },
});

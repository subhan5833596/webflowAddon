const { app } = require("@azure/functions");
const { decrypt } = require("../lib/crypto");
const { getSite } = require("../lib/storage");
const { cbConsumer, cbTrigger, jsonResponse, corsHeaders } = require("../lib/cbApi");

app.http("validate", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "validate/{site_id}",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders() };
    }

    const { site_id } = request.params;
    const results = {
      broker_ok: true,
      site_registered: false,
      secret_decryptable: false,
      consumer_token_minted: false,
      test_trigger_fired: false,
      consumer_token: null,
      errors: [],
    };

    // Step 1: Site registered?
    const row = await getSite(site_id);
    if (!row) {
      results.errors.push("Site not registered — go to Settings → Save");
      return jsonResponse(200, results);
    }
    results.site_registered = true;

    // Step 2: Secret decryptable?
    let secret;
    try {
      secret = decrypt(row.encrypted_secret);
      results.secret_decryptable = true;
    } catch (e) {
      results.errors.push("Secret decryption failed: " + e.message);
      return jsonResponse(200, results);
    }

    // Step 3: Mint consumer token from CentreBlock
    let consumerToken;
    try {
      const cbRes = await cbConsumer(secret, {
        uuid: "validate-test-" + Date.now(),
        customerId: row.customer_id,
        createdAt: new Date().toISOString(),
        audiences: [row.default_audience || "default"],
        tokenTimeToLive: 1,
        tags: { source: "validation" },
      });

      if (!cbRes.ok) {
        results.errors.push(
          "CentreBlock rejected consumer call (" + cbRes.status + "): " +
          JSON.stringify(cbRes.data).slice(0, 200)
        );
        return jsonResponse(200, results);
      }
      consumerToken = cbRes.data.data;
      results.consumer_token_minted = true;
      results.consumer_token = consumerToken
        ? consumerToken.slice(0, 16) + "..."
        : null;
    } catch (err) {
      results.errors.push("Consumer call failed: " + err.message);
      return jsonResponse(200, results);
    }

    // Step 4: Fire test trigger
    try {
      const cbRes = await cbTrigger(
        consumerToken,
        "validation_test",
        {
          tags: {
            page: "validation",
            direction: "Neutral",
            source: "validate-endpoint",
          },
        },
        true // isTest = true → uses /trigger/test/{name}
      );

      if (cbRes.status === 201 || cbRes.status === 200) {
        results.test_trigger_fired = true;
      } else {
        results.errors.push(
          "Test trigger returned " + cbRes.status + ": " + cbRes.text.slice(0, 150)
        );
      }
    } catch (err) {
      results.errors.push("Test trigger failed: " + err.message);
    }

    results.success =
      results.broker_ok &&
      results.site_registered &&
      results.secret_decryptable &&
      results.consumer_token_minted &&
      results.test_trigger_fired;

    return jsonResponse(200, results);
  },
});

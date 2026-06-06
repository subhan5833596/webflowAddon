// Azure Table Storage helpers
// Replaces broker-data.json from Render version
// Table: "sites" with PartitionKey="sites", RowKey=site_id

const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "sites";
const PARTITION_KEY = "sites";

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const conn = process.env.STORAGE_CONNECTION_STRING;
  if (!conn) {
    throw new Error("STORAGE_CONNECTION_STRING environment variable is required");
  }
  cachedClient = TableClient.fromConnectionString(conn, TABLE_NAME);
  return cachedClient;
}

async function upsertSite(siteId, data) {
  const client = getClient();
  const entity = {
    partitionKey: PARTITION_KEY,
    rowKey: siteId,
    site_id: siteId,
    encrypted_secret: data.encrypted_secret || "",
    customer_id: data.customer_id || "",
    domain: data.domain || "",
    default_audience: data.default_audience || "default",
    debug: data.debug ? "true" : "false",
    environment: data.environment || "prod",
    created_at: data.created_at || new Date().toISOString(),
  };
  await client.upsertEntity(entity, "Replace");
}

async function getSite(siteId) {
  const client = getClient();
  try {
    const entity = await client.getEntity(PARTITION_KEY, siteId);
    return {
      site_id: entity.site_id,
      encrypted_secret: entity.encrypted_secret,
      customer_id: entity.customer_id,
      domain: entity.domain,
      default_audience: entity.default_audience,
      debug: entity.debug === "true",
      environment: entity.environment,
      created_at: entity.created_at,
    };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function listSites() {
  const client = getClient();
  const sites = [];
  const iterator = client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` },
  });
  for await (const entity of iterator) {
    sites.push({
      site_id: entity.site_id,
      customer_id: entity.customer_id,
      domain: entity.domain,
      default_audience: entity.default_audience,
      debug: entity.debug === "true",
      environment: entity.environment,
      created_at: entity.created_at,
    });
  }
  return sites;
}

module.exports = { upsertSite, getSite, listSites };

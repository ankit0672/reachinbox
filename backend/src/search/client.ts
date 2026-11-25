import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";
import { EmailIndex, emailIndexName } from "./emailIndex.js";

// Short timeout + one retry: a slow or dead cluster must not stall sends.
export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: env.ES_REQUEST_TIMEOUT_MS,
  maxRetries: 1,
});

export const emailIndex = new EmailIndex(esClient, emailIndexName(env.ES_INDEX_PREFIX), {
  chunkSize: env.ES_BULK_CHUNK_SIZE,
});

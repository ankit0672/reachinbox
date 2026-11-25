import { randomUUID } from "node:crypto";
import { Client } from "@elastic/elasticsearch";
import { EmailIndex, emailIndexName, type EmailDoc } from "../../src/search/emailIndex.js";

const ES_URL = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";

/** A throwaway index (`reachinbox-test-<uuid>-emails`) so tests never touch the dev index. */
export async function createTestIndex(chunkSize = 500) {
  const client = new Client({ node: ES_URL });
  const name = emailIndexName(`reachinbox-test-${randomUUID()}`);
  const index = new EmailIndex(client, name, { chunkSize });
  await index.ensureIndex();
  return {
    client,
    name,
    index,
    async count() {
      await index.refresh();
      return (await client.count({ index: name })).count;
    },
    async get(id: string) {
      await index.refresh();
      const res = await client.get<EmailDoc>({ index: name, id }, { ignore: [404] });
      return res.found ? (res._source as EmailDoc) : null;
    },
    async cleanup() {
      await client.indices.delete({ index: name }, { ignore: [404] });
      await client.close();
    },
  };
}

/** An index whose cluster is unreachable: every call fails fast with ECONNREFUSED. */
export function deadIndex() {
  const client = new Client({ node: "http://127.0.0.1:1", maxRetries: 0, requestTimeout: 1000 });
  return new EmailIndex(client, "unreachable-emails", { chunkSize: 500 });
}

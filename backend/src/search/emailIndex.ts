import type { Client } from "@elastic/elasticsearch";
import type { Email } from "../generated/prisma/client.js";
import { describeError } from "../lib/describeError.js";

export type EmailDocStatus = "scheduled" | "processing" | "sent" | "failed";

/** One document per email row, _id = email.id (PLAN.md 5.7). */
export interface EmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  toEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  status: EmailDocStatus;
  scheduledAt: string;
  sentAt: string | null;
}

export const EMAIL_INDEX_MAPPING = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    userId: { type: "keyword" },
    campaignId: { type: "keyword" },
    status: { type: "keyword" },
    senderEmail: { type: "keyword" },
    // keyword for exact filters; the .text sub-field lets q match "lead1" in "lead1@acme.com"
    toEmail: { type: "keyword", fields: { text: { type: "text" } } },
    subject: { type: "text" },
    body: { type: "text" },
    scheduledAt: { type: "date" },
    sentAt: { type: "date" },
  },
} as const;

export const emailIndexName = (prefix: string) => `${prefix}-emails`;

export function toEmailDoc(email: Email & { sender: { email: string } }): EmailDoc {
  return {
    id: email.id,
    userId: email.userId,
    campaignId: email.campaignId,
    toEmail: email.toEmail,
    senderEmail: email.sender.email,
    subject: email.subject,
    body: email.body,
    status: email.status.toLowerCase() as EmailDocStatus,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
  };
}

export interface SearchParams {
  userId: string;
  q?: string;
  status?: EmailDocStatus;
  page: number;
  pageSize: number;
}

export class EmailIndex {
  constructor(
    private readonly client: Client,
    readonly name: string,
    private readonly opts: { chunkSize: number },
  ) {}

  /** Creates the index with the explicit mapping if it isn't there. Safe to call from every process. */
  async ensureIndex(): Promise<"created" | "exists"> {
    if (await this.client.indices.exists({ index: this.name })) return "exists";
    try {
      await this.client.indices.create({ index: this.name, mappings: EMAIL_INDEX_MAPPING });
      return "created";
    } catch (err) {
      // API and worker booting together: the other one won the create.
      if (JSON.stringify(err).includes("resource_already_exists_exception")) return "exists";
      throw err;
    }
  }

  /** Full-document index (create or overwrite), in bulk chunks. */
  async indexMany(docs: EmailDoc[]): Promise<void> {
    for (let i = 0; i < docs.length; i += this.opts.chunkSize) {
      const chunk = docs.slice(i, i + this.opts.chunkSize);
      await this.bulk(chunk.flatMap((doc) => [{ index: { _index: this.name, _id: doc.id } }, doc]));
    }
  }

  /**
   * Status change. Sends the whole doc with doc_as_upsert, so if the original
   * create never made it, this still leaves a complete, searchable document.
   */
  async upsert(doc: EmailDoc): Promise<void> {
    await this.client.update({
      index: this.name,
      id: doc.id,
      doc,
      doc_as_upsert: true,
      retry_on_conflict: 3,
    });
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length) await this.bulk(ids.map((id) => ({ delete: { _index: this.name, _id: id } })));
  }

  async search(p: SearchParams): Promise<{ total: number; results: EmailDoc[] }> {
    const filter: object[] = [{ term: { userId: p.userId } }]; // always scoped to the caller
    if (p.status) filter.push({ term: { status: p.status } });
    const res = await this.client.search<EmailDoc>({
      index: this.name,
      from: (p.page - 1) * p.pageSize,
      size: p.pageSize,
      track_total_hits: true,
      query: {
        bool: {
          filter,
          ...(p.q
            ? {
                must: [
                  { multi_match: { query: p.q, fields: ["subject^2", "body", "toEmail.text"] } },
                ],
              }
            : {}),
        },
      },
      sort: p.q
        ? ["_score", { scheduledAt: "desc" }, { id: "asc" }]
        : [{ scheduledAt: "desc" }, { id: "asc" }],
    });
    const total =
      typeof res.hits.total === "number" ? res.hits.total : (res.hits.total?.value ?? 0);
    return { total, results: res.hits.hits.map((h) => h._source!) };
  }

  /** Every document id in the index, in chunks (search_after on the id field). */
  async *scanIds(chunkSize: number): AsyncGenerator<string[]> {
    let after: string[] | undefined;
    for (;;) {
      const res = await this.client.search<{ id: string }>({
        index: this.name,
        size: chunkSize,
        _source: false,
        query: { match_all: {} },
        sort: [{ id: "asc" }],
        ...(after ? { search_after: after } : {}),
      });
      const hits = res.hits.hits;
      if (hits.length === 0) return;
      yield hits.map((h) => h._id!);
      after = hits[hits.length - 1]!.sort as string[];
    }
  }

  async refresh(): Promise<void> {
    await this.client.indices.refresh({ index: this.name });
  }

  private async bulk(operations: object[]): Promise<void> {
    const res = await this.client.bulk({ operations });
    if (res.errors) {
      const failed = res.items.find((item) => Object.values(item)[0]?.error);
      const error = failed && Object.values(failed)[0]?.error;
      throw new Error(`bulk request had failures, e.g. ${error?.type}: ${error?.reason}`);
    }
  }
}

/**
 * Elasticsearch is a secondary index: a failure here must never break
 * scheduling or sending. Log it and carry on; `npm run reindex` resyncs.
 */
export async function bestEffort<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(
      `[search] ${what} failed (Postgres is unaffected; run "npm run reindex" to resync): ${describeError(err)}`,
    );
    return undefined;
  }
}

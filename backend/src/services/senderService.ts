import nodemailer from "nodemailer";
import { prisma } from "../db/prisma.js";
import type { Sender } from "../generated/prisma/client.js";

export interface SmtpAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number };
}

export type AccountFactory = () => Promise<SmtpAccount>;

// Hits the Ethereal API for a brand-new fake inbox. nodemailer caches one
// account per process unless ETHEREAL_CACHE is off, which would hand every
// sender in the pool the same credentials.
export const createEtherealAccount: AccountFactory = () => {
  process.env.ETHEREAL_CACHE = "no";
  return nodemailer.createTestAccount();
};

// Arbitrary constant: identifies "the sender pool" lock in pg_advisory_xact_lock.
const SENDER_POOL_LOCK_ID = 7_301_001;

/**
 * Makes sure at least `size` senders exist and returns the whole pool.
 * Safe to call from every process on boot: a Postgres advisory lock makes
 * concurrent callers queue up, so the API and worker starting together
 * can't both see "0 senders" and create 2N accounts.
 */
export async function ensureSenderPool(
  size: number,
  createAccount: AccountFactory = createEtherealAccount,
): Promise<Sender[]> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SENDER_POOL_LOCK_ID})`;

      const existing = await tx.sender.count();
      for (let n = existing + 1; n <= size; n++) {
        const account = await createAccount();
        if (await tx.sender.findUnique({ where: { email: account.user } })) {
          throw new Error(`Account factory returned a duplicate account (${account.user})`);
        }
        await tx.sender.create({
          data: {
            email: account.user,
            smtpHost: account.smtp.host,
            smtpPort: account.smtp.port,
            smtpUser: account.user,
            smtpPass: account.pass,
            label: `Sender ${n}`,
          },
        });
      }
    },
    // Account creation is a network call per sender; give it room.
    { timeout: 60_000, maxWait: 60_000 },
  );

  return listSenders();
}

export function listSenders(): Promise<Sender[]> {
  return prisma.sender.findMany({ orderBy: [{ createdAt: "asc" }, { email: "asc" }] });
}

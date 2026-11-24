import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { ensureSenderPool, type SmtpAccount } from "../src/services/senderService.js";

// Stand-in for Ethereal so tests are fast, offline and deterministic.
let counter = 0;
const fakeAccount = vi.fn(async (): Promise<SmtpAccount> => {
  counter += 1;
  return {
    user: `fake${counter}@ethereal.test`,
    pass: "secret",
    smtp: { host: "smtp.ethereal.email", port: 587 },
  };
});

beforeEach(async () => {
  await prisma.email.deleteMany();
  await prisma.sender.deleteMany();
  fakeAccount.mockClear();
});

afterAll(() => prisma.$disconnect());

describe("ensureSenderPool", () => {
  it("creates N senders on first boot", async () => {
    await ensureSenderPool(3, fakeAccount);
    expect(await prisma.sender.count()).toBe(3);
    expect(fakeAccount).toHaveBeenCalledTimes(3);
  });

  it("is a no-op when the pool is already full (second boot)", async () => {
    await ensureSenderPool(3, fakeAccount);
    fakeAccount.mockClear();
    const senders = await ensureSenderPool(3, fakeAccount);
    expect(fakeAccount).not.toHaveBeenCalled();
    expect(senders).toHaveLength(3);
  });

  it("only tops up the missing accounts when the pool size grows", async () => {
    await ensureSenderPool(2, fakeAccount);
    fakeAccount.mockClear();
    await ensureSenderPool(3, fakeAccount);
    expect(fakeAccount).toHaveBeenCalledTimes(1);
    expect(await prisma.sender.count()).toBe(3);
  });

  it("never over-creates when API and worker boot at the same time", async () => {
    await Promise.all([
      ensureSenderPool(3, fakeAccount),
      ensureSenderPool(3, fakeAccount),
      ensureSenderPool(3, fakeAccount),
    ]);
    expect(await prisma.sender.count()).toBe(3);
  });

  it("rejects a factory that hands back the same account twice, leaving no partial pool", async () => {
    // Regression: nodemailer.createTestAccount() caches one account per process by default.
    const sameEveryTime = async (): Promise<SmtpAccount> => ({
      user: "cached@ethereal.test",
      pass: "secret",
      smtp: { host: "smtp.ethereal.email", port: 587 },
    });
    await expect(ensureSenderPool(3, sameEveryTime)).rejects.toThrow(/duplicate account/i);
    expect(await prisma.sender.count()).toBe(0);
  });

  it("stores the SMTP credentials and a readable label", async () => {
    const [sender] = await ensureSenderPool(1, fakeAccount);
    expect(sender).toMatchObject({
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      smtpPass: "secret",
      label: "Sender 1",
    });
    expect(sender?.email).toBe(sender?.smtpUser);
  });
});

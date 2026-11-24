import { describe, expect, it } from "vitest";
import {
  PlanningHorizonError,
  planEmails,
  type PlanContext,
} from "../src/services/scheduleService.js";
import type { Sender } from "../src/generated/prisma/client.js";

const H = 3_600_000;
const W0 = 500_000; // an arbitrary window index; W0 * H is a UTC hour start
const at = (window: number, offsetMs = 0) => new Date(window * H + offsetMs);

const senders = ["s1", "s2", "s3"].map((id) => ({ id }) as Sender);
const leads = (n: number) => Array.from({ length: n }, (_, i) => `lead${i}@example.com`);

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    now: at(W0, 0).getTime(),
    windowMs: H,
    perSenderCap: 0,
    globalCap: 0,
    horizonMs: 30 * 24 * H,
    existing: [],
    ...overrides,
  };
}
const input = (o: { startTime?: Date; delayBetweenMs?: number; hourlyLimit?: number } = {}) => ({
  subject: "s",
  body: "b",
  startTime: o.startTime ?? at(W0, 10 * 60_000),
  delayBetweenMs: o.delayBetweenMs ?? 0,
  hourlyLimit: o.hourlyLimit ?? 100,
});
const windowsOf = (planned: { scheduledAt: Date }[]) =>
  planned.map((p) => Math.floor(p.scheduledAt.getTime() / H) - W0);

describe("planEmails (pre-packing)", () => {
  it("8 leads, per-sender limit 3, one sender: 3 / 3 / 2 across windows, in seq order", () => {
    const planned = planEmails(leads(8), input({ hourlyLimit: 3 }), [senders[0]!], ctx());
    expect(windowsOf(planned)).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
    expect(planned.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // overflow lands exactly on the next window start
    expect(planned[3]!.scheduledAt).toEqual(at(W0 + 1));
    const times = planned.map((p) => p.scheduledAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times); // non-decreasing in seq
  });

  it("keeps delayBetweenMs as the gap and resumes from the next window start after an overflow", () => {
    const min = 60_000;
    const planned = planEmails(
      leads(5),
      input({ startTime: at(W0, 50 * min), delayBetweenMs: 10 * min, hourlyLimit: 2 }),
      [senders[0]!],
      ctx(),
    );
    expect(planned.map((p) => p.scheduledAt)).toEqual([
      at(W0, 50 * min), // w0
      at(W0 + 1, 0), // :50 + 10m crosses into w1 naturally
      at(W0 + 1, 10 * min), // w1 now full (2)
      at(W0 + 2, 0), // overflow -> next window start
      at(W0 + 2, 10 * min),
    ]);
  });

  it("counts emails already scheduled for the sender by earlier campaigns", () => {
    const planned = planEmails(
      leads(3),
      input({ hourlyLimit: 10 }),
      [senders[0]!],
      ctx({ perSenderCap: 3, existing: [{ senderId: "s1", window: W0, count: 2 }] }),
    );
    expect(windowsOf(planned)).toEqual([0, 1, 1]);
  });

  it("rotates over senders that still have capacity, skipping full ones", () => {
    const planned = planEmails(
      leads(5),
      input({ hourlyLimit: 1 }),
      senders,
      ctx({ perSenderCap: 1, existing: [{ senderId: "s1", window: W0, count: 1 }] }),
    );
    expect(planned.map((p) => `${p.senderId}@w${windowsOf([p])[0]}`)).toEqual([
      "s2@w0",
      "s3@w0",
      "s1@w1",
      "s2@w1",
      "s3@w1",
    ]);
  });

  it("starts the rotation at the least-loaded sender, ties broken by sender order", () => {
    const existing = [
      { senderId: "s1", window: W0, count: 5 },
      { senderId: "s3", window: W0, count: 2 },
    ];
    const planned = planEmails(leads(4), input(), senders, ctx({ existing }));
    expect(planned.map((p) => p.senderId)).toEqual(["s2", "s3", "s1", "s2"]);

    const tie = planEmails(leads(2), input(), senders, ctx());
    expect(tie.map((p) => p.senderId)).toEqual(["s1", "s2"]);
  });

  it("plans a past startTime from now (current window), not from the past", () => {
    const now = at(W0, 30 * 60_000).getTime();
    const planned = planEmails(
      leads(2),
      input({ startTime: at(W0 - 2, 0), delayBetweenMs: 1000 }),
      senders,
      ctx({ now }),
    );
    expect(planned.map((p) => p.scheduledAt.getTime())).toEqual([now, now + 1000]);
  });

  it("respects the optional global cap across all senders", () => {
    const existing = [
      { senderId: "s1", window: W0, count: 2 },
      { senderId: "s2", window: W0, count: 1 },
    ];
    const planned = planEmails(leads(3), input(), senders, ctx({ globalCap: 4, existing }));
    expect(windowsOf(planned)).toEqual([0, 1, 1]);
  });

  it("treats 0 as 'no cap' for the sender and global caps", () => {
    const existing = [{ senderId: "s1", window: W0, count: 10_000 }];
    const planned = planEmails(leads(5), input(), [senders[0]!], ctx({ existing }));
    expect(windowsOf(planned)).toEqual([0, 0, 0, 0, 0]);
  });

  it("refuses a plan that would run past the planning horizon", () => {
    expect(() =>
      planEmails(leads(100), input({ hourlyLimit: 1 }), [senders[0]!], ctx({ horizonMs: 24 * H })),
    ).toThrow(PlanningHorizonError);
  });

  it("uses epoch-based windows of any length (RATE_LIMIT_WINDOW_MS)", () => {
    const windowMs = 10_000;
    const now = 170_000_000_000; // a multiple of 10s
    const planned = planEmails(
      leads(5),
      input({ startTime: new Date(now), hourlyLimit: 2 }),
      [senders[0]!],
      ctx({ now, windowMs }),
    );
    expect(planned.map((p) => p.scheduledAt.getTime() - now)).toEqual([
      0, 0, 10_000, 10_000, 20_000,
    ]);
  });
});

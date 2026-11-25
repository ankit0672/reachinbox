import { afterEach, describe, expect, it } from "vitest";
import { emptyCompose, mapServerErrors, toScheduleRequest, validateCompose } from "./validation";

const valid = () => ({
  ...emptyCompose(),
  entries: ["a@x.io"],
  subject: "Hello",
  body: "Hi there",
  delaySeconds: "2",
  hourlyLimit: "10",
});

describe("validateCompose", () => {
  it("accepts a complete form", () => {
    expect(validateCompose(valid(), 100)).toEqual({});
  });

  it("requires subject, body, a valid recipient, delay and limit", () => {
    expect(validateCompose({ ...emptyCompose(), entries: ["bad@"], subject: "  " }, 100)).toEqual({
      recipients: "Add at least one valid recipient.",
      subject: "Subject is required.",
      body: "Write the email body.",
      delay: "Enter the delay in seconds.",
      hourlyLimit: "Enter a whole number.",
    });
  });

  it.each([
    ["0", "At least 1 second."],
    ["0.5", "At least 1 second."],
    ["abc", "Enter the delay in seconds."],
    ["86401", "At most 24 hours (86400 seconds)."],
  ])("delay %s -> %s", (delaySeconds, message) => {
    expect(validateCompose({ ...valid(), delaySeconds }, 100).delay).toBe(message);
  });

  it.each([
    ["0", "At least 1."],
    ["2.5", "Enter a whole number."],
    ["100001", "At most 100000."],
  ])("hourly limit %s -> %s", (hourlyLimit, message) => {
    expect(validateCompose({ ...valid(), hourlyLimit }, 100).hourlyLimit).toBe(message);
  });

  it("blocks a list over the campaign limit (duplicates and invalid count too)", () => {
    const entries = ["a@x.io", "a@x.io", "bad@"];
    expect(validateCompose({ ...valid(), entries }, 2).recipients).toMatch(
      /too many addresses: 3 \(the limit is 2/i,
    );
    expect(validateCompose({ ...valid(), entries }, 3).recipients).toBeUndefined();
  });
});

describe("toScheduleRequest", () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("sends startTime as ISO with the local offset, delay in ms, the raw entries", () => {
    process.env.TZ = "Asia/Kolkata";
    const startAt = new Date("2026-11-26T04:30:00Z");
    const req = toScheduleRequest({
      ...valid(),
      entries: ["A@x.io", "a@x.io", "bad@"],
      subject: "  Hello  ",
      delaySeconds: "1.5",
      startAt,
    });
    expect(req).toEqual({
      subject: "Hello",
      body: "Hi there",
      startTime: "2026-11-26T10:00:00+05:30",
      delayBetweenMs: 1500,
      hourlyLimit: 10,
      leads: ["A@x.io", "a@x.io", "bad@"],
    });
  });

  it("start now = the current time, still with an offset", () => {
    process.env.TZ = "Asia/Kolkata";
    const req = toScheduleRequest(valid(), new Date("2026-11-25T12:00:00Z"));
    expect(req.startTime).toBe("2026-11-25T17:30:00+05:30");
  });
});

describe("mapServerErrors", () => {
  it("maps API field names (including leads.N) onto the form", () => {
    const { fields, form } = mapServerErrors({
      error: "Validation failed",
      details: [
        { field: "subject", message: "subject is required" },
        { field: "leads.4", message: "Too big: expected string to have <=320 characters" },
        { field: "hourlyLimit", message: "Too big" },
        { field: "delayBetweenMs", message: "Too small" },
      ],
    });
    expect(fields).toEqual({
      subject: "Subject is required",
      recipients: "Too big: expected string to have <=320 characters",
      hourlyLimit: "Too big",
      delay: "The server rejected this delay: Too small",
    });
    expect(form).toBeUndefined();
  });

  it("returns a form-level message when there are no field details", () => {
    expect(mapServerErrors({ error: "No valid lead email addresses" })).toEqual({
      fields: {},
      form: "No valid lead email addresses",
    });
  });
});

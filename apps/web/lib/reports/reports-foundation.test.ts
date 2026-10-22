import { describe, expect, it } from "vitest";
import { parsePeriod, reportHref, reportDay } from "./filters";
import { crossSite, csvAmount, csvDocument } from "./csv";

describe("report URL convention", () => {
  it("parses the accepted periods; custom needs a valid range of at most 92 days", () => {
    expect(parsePeriod({}, "last_30_days")).toEqual({ ok: true, value: { period: "last_30_days", from: null, to: null } });
    expect(parsePeriod({ period: "today", from: "2026-01-01" }, "last_30_days")).toEqual({ ok: true, value: { period: "today", from: null, to: null } });
    expect(parsePeriod({ period: "custom", from: "2026-09-01", to: "2026-10-01" }, "today")).toEqual({ ok: true, value: { period: "custom", from: "2026-09-01", to: "2026-10-01" } });
    expect(parsePeriod({ period: "custom", from: "2026-01-01", to: "2026-10-01" }, "today")).toMatchObject({ ok: false, invalid: false, error: expect.stringContaining("92 días") });
    expect(parsePeriod({ period: "custom", from: "2026-10-02", to: "2026-10-01" }, "today")).toMatchObject({ ok: false, invalid: false });
    expect(parsePeriod({ period: "yesterday" }, "today")).toMatchObject({ ok: false, invalid: true });
    expect(parsePeriod({ period: ["today", "custom"] }, "last_7_days")).toMatchObject({ ok: true, value: { period: "last_7_days" } });
  });
  it("builds readable URLs without empty filters", () => {
    expect(reportHref("/r", { school: "s", status: "", grade: "4to A", location: null })).toBe("/r?school=s&grade=4to+A");
    expect(reportDay("2026-10-21")).toBe("21/10/2026");
  });
});
describe("report CSV", () => {
  it("is spreadsheet-safe with plain signed decimal amounts", () => {
    const csv = csvDocument(["Nombre", "Monto"], [["=HYPERLINK()", csvAmount("-1500")], ['Ana "A"', csvAmount("1234567")]]);
    expect(csv.startsWith("﻿")).toBe(true); expect(csv).toContain('"\'=HYPERLINK()","-15.00"'); expect(csv).toContain('"Ana ""A""","12345.67"'); expect(csv.endsWith("\r\n")).toBe(true);
    expect(csvAmount("0").csvNumber).toBe("0.00"); expect(csvAmount("5").csvNumber).toBe("0.05");
  });
  it("refuses cross-site requests; same-site and direct navigation pass", () => {
    const req = (site?: string) => new Request("http://x/r", { headers: site ? { "sec-fetch-site": site } : {} });
    expect([crossSite(req()), crossSite(req("same-origin")), crossSite(req("none")), crossSite(req("cross-site")), crossSite(req("same-site"))]).toEqual([false, false, false, true, true]);
  });
});

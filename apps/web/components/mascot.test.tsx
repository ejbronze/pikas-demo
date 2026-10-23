import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
(globalThis as { React?: typeof React }).React = React;
import { PikasMascot, PikasLoader, mascotAssets, mascotManifest, mascotSizeRange } from "@pikas/ui/mascot";

// Mascot Phase 1: the shared component honours the manifest (ids, sizes, motion, alt) and is decorative by default.
describe("PikasMascot (shared @pikas/ui)", () => {
  it("renders a known id as a decorative image: empty alt, aria-hidden, lazy, not draggable", () => {
    const html = renderToStaticMarkup(<PikasMascot id="EMP-02" size={120} />);
    expect(html).toContain('alt=""'); expect(html).toContain('aria-hidden="true"'); expect(html).toContain('width="120"'); expect(html).toContain('data-mascot="EMP-02"');
    expect(html).toContain('loading="lazy"'); expect(html).toContain('draggable="false"'); expect(html).toMatch(/src="(data:image\/svg\+xml|[^"]*\.svg)/); // bundlers may inline the file
  });
  it("meaningful uses the manifest's Spanish alt text (or an override) and drops aria-hidden", () => {
    const html = renderToStaticMarkup(<PikasMascot id="FND-01" meaningful />);
    expect(html).toContain('alt="PIKAS, la mascota de PIKAS, de pie y sonriendo"'); expect(html).not.toContain("aria-hidden");
    expect(renderToStaticMarkup(<PikasMascot id="FND-01" meaningful alt="PIKAS saluda" />)).toContain('alt="PIKAS saluda"');
  });
  it("animated picks the motion file only when the asset has one", () => {
    const still = renderToStaticMarkup(<PikasMascot id="EMP-02" />), moving = renderToStaticMarkup(<PikasMascot id="EMP-02" animated />);
    expect(moving).toContain('data-animated="true"'); expect(moving.match(/src="([^"]*)"/)?.[1]).not.toBe(still.match(/src="([^"]*)"/)?.[1]);
    expect(renderToStaticMarkup(<PikasMascot id="CAF-01" animated />)).not.toContain("data-animated");
  });
  it("unknown ids render nothing and warn outside production; sizes outside the manifest range warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(renderToStaticMarkup(<PikasMascot id="NOPE-99" />)).toBe(""); expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown id "NOPE-99"'));
    renderToStaticMarkup(<PikasMascot id="EMP-02" size={12} />); expect(warn).toHaveBeenCalledWith(expect.stringContaining("12px is outside"));
    warn.mockRestore();
  });
  it("manifest: 36 assets, every file in the generated map, size ranges never below 24 px, hat only on onboarding/cafetería/POS sets", () => {
    expect(mascotManifest.assets).toHaveLength(36); expect(mascotAssets.size).toBe(36);
    for (const a of mascotManifest.assets) {
      expect(renderToStaticMarkup(<PikasMascot id={a.id} size={mascotSizeRange(a)[0]} />)).toContain(`data-mascot="${a.id}"`);
      expect(mascotSizeRange(a)[0]).toBeGreaterThanOrEqual(24);
      // The cap is on for the onboarding/cafetería/POS sets; the only other capped files are the small capped head marks (FND-08c/FND-08s).
      if (a.cap) expect(["onboarding", "cafeteria", "pos"].includes(a.set) || a.id.startsWith("FND-08")).toBe(true);
      else expect(["onboarding", "cafeteria", "pos"].includes(a.set)).toBe(false);
    }
  });
});

describe("PikasLoader", () => {
  it("starts silent for sighted users with the status text available to screen readers", () => {
    const html = renderToStaticMarkup(<PikasLoader label="Cargando plataforma…" />);
    expect(html).toContain('role="status"'); expect(html).toContain("Cargando plataforma…"); expect(html).not.toContain("<img"); expect(html).toContain('data-phase="hidden"');
  });
});

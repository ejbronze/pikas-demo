import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Social preview (Brand & Public): the approved logo, the brand line and the protected sentence on brand colors.
// Generated from existing assets only — no new illustration or invented imagery. Rendered at build time.
export const alt = "PIKAS — La cafetería escolar, por fin conectada.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/brand/pikas-logo-horizontal-full-color.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "linear-gradient(135deg, #ffffff 0%, #fffaf0 55%, #d9f7f6 100%)", color: "#03234b" }}>
      <img src={src} width={318} height={120} alt="" />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1 }}>La cafetería escolar, por fin conectada.</div>
        <div style={{ display: "flex", fontSize: 32, lineHeight: 1.35, color: "#53627c", maxWidth: 940 }}>PIKAS conecta las personas, la operación y el dinero detrás de la cafetería escolar.</div>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {["Colegio", "Cafetería", "Punto de venta", "PIKAS Cash"].map((t, i) => <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderRadius: 999, background: "#ffffff", border: "2px solid #dbe3ee", fontSize: 24, fontWeight: 700 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: ["#04c7c5", "#fcc932", "#03234b", "#08918f"][i] }} />{t}</div>)}
      </div>
    </div>,
    { ...size },
  );
}

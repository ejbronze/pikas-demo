// Reference component — adapt paths and styling to the codebase.
// Renders any PIKAS mascot asset by its manifest id. Decorative by default.
import manifest from "@/public/brand/mascot/manifest.json"; // adjust the import path

type Asset = (typeof manifest.assets)[number];
const BASE = "/brand/mascot";
const byId = new Map<string, Asset>(manifest.assets.map((a) => [a.id, a]));

export type PikasMascotProps = {
  id: string;              // e.g. "EMP-02"
  size?: number;           // display width in px; checked against the asset's sizePx range in development
  animated?: boolean;      // use the asset's motion file when it has one
  meaningful?: boolean;    // true only when the picture adds information the text doesn't
  alt?: string;            // overrides altWhenMeaningful
  className?: string;
};

export function PikasMascot({ id, size = 160, animated = false, meaningful = false, alt, className }: PikasMascotProps) {
  const asset = byId.get(id);
  if (!asset) {
    if (process.env.NODE_ENV !== "production") console.warn(`PikasMascot: unknown id "${id}"`);
    return null;
  }
  if (process.env.NODE_ENV !== "production") {
    const [min, max] = asset.sizePx.split("-").map(Number);
    if (size < Math.max(24, min) || size > max) console.warn(`PikasMascot ${id}: ${size}px is outside ${asset.sizePx}px`);
  }
  const file = animated && asset.motionFile ? asset.motionFile : asset.file;
  const label = meaningful ? alt ?? asset.altWhenMeaningful ?? "" : "";
  return (
    <img
      src={`${BASE}/${file}`}
      width={size}
      alt={label}
      aria-hidden={label ? undefined : true}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

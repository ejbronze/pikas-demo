// PIKAS mascot: renders any catalog asset by its manifest id. Decorative by default (alt="" + aria-hidden);
// `meaningful` uses the manifest's Spanish alt text only when the picture adds information the text
// does not. Lightweight on purpose: no loading, session or page behaviour lives here (see PikasLoader,
// PikasSessionCountdown). The SVG files are used exactly as delivered; motion is CSS inside the file and
// already honours prefers-reduced-motion.
import { assetFiles, type StaticAsset } from "./assets.generated";
import { assetsById, sizeRange, type MascotAsset } from "./manifest";

export type PikasMascotProps = {
  id: string;              // manifest id, e.g. "EMP-02"
  size?: number;           // display width in CSS px; checked against the asset's sizePx range outside production
  animated?: boolean;      // use the asset's motion file when it has one (one animated mascot per screen at most)
  meaningful?: boolean;    // true only when the picture adds information the surrounding text doesn't
  alt?: string;            // overrides the manifest alt text (meaningful only)
  className?: string;
};

export const assetUrl = (file: StaticAsset): string => (typeof file === "string" ? file : file.src);
export function mascotAsset(id: string): MascotAsset | undefined { return assetsById.get(id); }

export function PikasMascot({ id, size = 160, animated = false, meaningful = false, alt, className }: PikasMascotProps) {
  const asset = assetsById.get(id), files = assetFiles[id];
  if (!asset || !files) {
    if (process.env.NODE_ENV !== "production") console.warn(`PikasMascot: unknown id "${id}"`);
    return null;
  }
  if (process.env.NODE_ENV !== "production") {
    const [min, max] = sizeRange(asset);
    if (size < min || size > max) console.warn(`PikasMascot ${id}: ${size}px is outside the ${asset.sizePx}px range`);
  }
  const file = animated && files.motion ? files.motion : files.file;
  const label = meaningful ? (alt ?? asset.altWhenMeaningful ?? "") : "";
  return <img src={assetUrl(file)} width={size} alt={label} aria-hidden={label ? undefined : true} className={className}
    loading="lazy" decoding="async" draggable={false} data-mascot={id} data-animated={animated && files.motion ? "true" : undefined} />;
}

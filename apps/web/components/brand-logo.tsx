import Image from "next/image";

type BrandLogoProps = { compact?: boolean; className?: string; priority?: boolean };

export function BrandLogo({compact = false, className = "", priority = false}: BrandLogoProps) {
  const src = compact ? "/brand/pikas-logo-mark-full-color.png" : "/brand/pikas-logo-horizontal-full-color.png";
  return <Image
    alt="PIKAS"
    className={`object-contain ${className}`}
    height={compact ? 40 : 34}
    priority={priority}
    src={src}
    width={compact ? 40 : 180}
  />;
}

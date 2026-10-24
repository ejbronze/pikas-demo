import { getImageProps } from "next/image";
import { shots, type ShotId } from "./shots.generated";

// A real PIKAS screen (local fictional capture) in a quiet app frame. With `mobile`, phones receive a capture
// composed at 390 px instead of a shrunken desktop screen (art direction through <picture>).
export function ProductShot({ id, mobile, alt, priority = false, sizes = "(min-width: 1024px) 56vw, 100vw", className = "" }: { id: ShotId; mobile?: ShotId; alt: string; priority?: boolean; sizes?: string; className?: string }) {
  const desktop = shots[id];
  const common = { alt, sizes, quality: 75, priority, loading: priority ? undefined : ("lazy" as const) };
  const { props: d } = getImageProps({ ...common, src: desktop.src, width: desktop.width, height: desktop.height });
  const small = mobile ? getImageProps({ ...common, src: shots[mobile].src, width: shots[mobile].width, height: shots[mobile].height, sizes: "100vw" }).props : null;
  return <figure className={`site-shot ${className}`} data-shot={id}>
    <div className="site-shot-bar" aria-hidden><span /><span /><span /></div>
    <picture>
      {small && <source media="(max-width: 639px)" srcSet={small.srcSet} sizes="100vw" width={shots[mobile!].width} height={shots[mobile!].height} />}
      {/* props come from next/image getImageProps (optimized srcset) */}
      <img {...d} alt={alt} className="site-shot-img" />
    </picture>
  </figure>;
}

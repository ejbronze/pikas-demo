"use client";
// "Así se ve un día…": a restrained scroll story. On large screens the product frame stays in view (sticky) while
// the steps scroll past; the active step decides which real screen is shown. Nothing is scroll-jacked: the
// page scrolls normally, steps are ordinary sections, and every step also carries its own screen on smaller
// screens (and when JavaScript is unavailable the first screen stays visible). Reduced motion swaps screens
// without transitions (global rule).
import { useEffect, useRef, useState } from "react";
import { ProductShot } from "./product-shot";
import { site } from "./content";

export function ProductStory() {
  const steps = site.story.steps;
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
    }, { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return <div className="site-story">
    <ol className="site-story-steps">
      {steps.map((s, i) => <li key={s.id} ref={el => { refs.current[i] = el; }} data-index={i} data-active={i === active || undefined} className="site-story-step">
        <p className="site-story-label"><span className="site-story-n" aria-hidden>{String(i + 1).padStart(2, "0")}</span>{s.label}</p>
        <h3 className="site-h3">{s.title}</h3>
        <p className="site-body">{s.text}</p>
        <div className="site-story-inline"><ProductShot id={s.shot} mobile={"mobile" in s ? s.mobile : undefined} alt={s.alt} sizes="100vw" /></div>
      </li>)}
    </ol>
    <div className="site-story-stage">
      <div className="site-story-frame">
        {steps.map((s, i) => <div key={s.id} className="site-story-slide" data-active={i === active || undefined} aria-hidden={i !== active || undefined}>
          <ProductShot id={s.shot} alt={s.alt} sizes="(min-width: 1024px) 58vw, 1px" />
        </div>)}
      </div>
      <ol className="site-story-dots" aria-hidden>{steps.map((s, i) => <li key={s.id} data-active={i === active || undefined}>{s.label}</li>)}</ol>
    </div>
  </div>;
}

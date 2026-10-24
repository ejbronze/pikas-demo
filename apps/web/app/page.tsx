import type { Metadata } from "next";
import Link from "next/link";
import { PikasMascot } from "@pikas/ui/mascot";
import { BrandLogo } from "../components/brand-logo";
import { SiteHeader } from "../components/site/site-header";
import { ProductStory } from "../components/site/product-story";
import { ProductShot } from "../components/site/product-shot";
import { site } from "../components/site/content";
import "./site.css";

// Public PIKAS website (Brand & Public Experience). Server-rendered; only the header menu and the product
// story are client components. Every product image is a real PIKAS screen with fictional demo data.
export const metadata: Metadata = {
  title: { absolute: site.meta.title },
  description: site.meta.description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_DO", siteName: "PIKAS", url: "/", title: site.meta.title, description: site.meta.description },
  twitter: { card: "summary_large_image", title: site.meta.title, description: site.meta.description },
};

// The public contact channel is configuration, not code. Without it the section says how to reach PIKAS
// truthfully instead of offering a form with nowhere to go.
const contactEmail = process.env.NEXT_PUBLIC_PIKAS_CONTACT_EMAIL?.trim() || null;

function SectionHead({ eyebrow, title, lede, id }: { eyebrow: string; title: string; lede?: string; id: string }) {
  return <div className="site-section-head site-reveal">
    <p className="site-eyebrow">{eyebrow}</p>
    <h2 id={id} className="site-h2">{title}</h2>
    {lede && <p className="site-lede">{lede}</p>}
  </div>;
}

export default function Home() {
  const { hero, system, story, schools, cafeterias, pikasCash, trace, contact, footer } = site;
  return <div className="site">
    <a href="#contenido" className="site-skip">Saltar al contenido</a>
    <SiteHeader />
    <main id="contenido">
      <section className="site-hero" aria-labelledby="hero-title">
        <div className="site-wrap site-hero-grid">
          <div className="site-hero-copy">
            <p className="site-eyebrow">{hero.eyebrow}</p>
            <h1 id="hero-title" className="site-h1">{hero.title[0]} <br /><span className="site-h1-accent">{hero.title[1]}</span></h1>
            <p className="site-hero-lede">{hero.lede}</p>
            <div className="site-cta-row">
              <a className="site-btn site-btn-primary" href={hero.primary.href}>{hero.primary.label}</a>
              <a className="site-btn site-btn-secondary" href={hero.secondary.href}>{hero.secondary.label}</a>
            </div>
            <ul className="site-connects" aria-label="PIKAS conecta">{hero.connects.map(c => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="site-hero-visual">
            <ProductShot id="cafeteria-hoy" mobile="cafeteria-hoy-m" priority alt="Pantalla Hoy de una cafetería en PIKAS: colegio, sede y cafetería que administra y su guía de puesta en marcha." sizes="(min-width: 1024px) 52vw, 100vw" className="site-hero-shot" />
            <div className="site-hero-pos"><ProductShot id="pos-venta" alt="Punto de venta de PIKAS con una venta en curso para una estudiante." sizes="(min-width: 1024px) 26vw, 60vw" /></div>
            <PikasMascot id="FND-06" size={168} className="site-hero-mascot" />
          </div>
        </div>
        <p className="site-wrap site-fiction">{site.fiction}</p>
      </section>

      <section id="como-funciona" className="site-section" aria-labelledby="sistema-title">
        <div className="site-wrap">
          <SectionHead id="sistema-title" eyebrow={system.eyebrow} title={system.title} lede={system.lede} />
          <ol className="site-roles">
            {system.roles.map((r, i) => <li key={r.who} className="site-role site-reveal" data-role={i}>
              <p className="site-role-who">{r.who}</p>
              <p className="site-role-verb">{r.verb}.</p>
              <p className="site-body">{r.text}</p>
            </li>)}
          </ol>
          <ol className="site-flow site-reveal" aria-label="Cómo fluye la información">
            {system.flow.map(f => <li key={f.from}><span className="site-flow-route"><strong>{f.from}</strong><span aria-hidden className="site-flow-arrow">→</span><strong>{f.to}</strong></span><span className="site-flow-what">{f.what}</span></li>)}
          </ol>
        </div>
      </section>

      <section id="producto" className="site-section site-section-tint" aria-labelledby="producto-title">
        <div className="site-wrap">
          <SectionHead id="producto-title" eyebrow={story.eyebrow} title={story.title} />
          <ProductStory />
          <p className="site-fiction">{site.fiction}</p>
        </div>
      </section>

      <section className="site-section" aria-label="Para colegios y cafeterías">
        <div className="site-wrap site-audiences">
          <article id="colegios" aria-labelledby="colegios-title" className="site-audience">
            <SectionHead id="colegios-title" eyebrow={schools.eyebrow} title={schools.title} lede={schools.lede} />
            <ul className="site-features">{schools.items.map(it => <li key={it.title} className="site-reveal"><h3 className="site-h4">{it.title}</h3><p className="site-body">{it.text}</p></li>)}</ul>
            <p className="site-note">{schools.note}</p>
          </article>
          <article id="cafeterias" aria-labelledby="cafeterias-title" className="site-audience">
            <SectionHead id="cafeterias-title" eyebrow={cafeterias.eyebrow} title={cafeterias.title} lede={cafeterias.lede} />
            <ul className="site-features">{cafeterias.items.map(it => <li key={it.title} className="site-reveal"><h3 className="site-h4">{it.title}</h3><p className="site-body">{it.text}</p></li>)}</ul>
            <ProductShot id="cafeteria-productos" alt="Catálogo de productos de una cafetería en PIKAS con precio, categoría y disponibilidad." sizes="(min-width: 1024px) 40vw, 100vw" className="site-audience-shot" />
          </article>
        </div>
      </section>

      <section id="pikas-cash" className="site-section site-section-navy" aria-labelledby="cash-title">
        <div className="site-wrap site-cash">
          <div>
            <SectionHead id="cash-title" eyebrow={pikasCash.eyebrow} title={pikasCash.title} lede={pikasCash.lede} />
            <ul className="site-checks">{pikasCash.today.map(t => <li key={t}>{t}</li>)}</ul>
          </div>
          <aside className="site-cash-aside site-reveal" aria-labelledby="cash-not-yet">
            <PikasMascot id="FND-09" size={128} />
            <h3 id="cash-not-yet" className="site-h4">{pikasCash.notYetTitle}</h3>
            <p className="site-body">{pikasCash.notYet}</p>
          </aside>
        </div>
      </section>

      <section id="trazabilidad" className="site-section" aria-labelledby="traza-title">
        <div className="site-wrap">
          <SectionHead id="traza-title" eyebrow={trace.eyebrow} title={trace.title} lede={trace.lede} />
          <ul className="site-trace">{trace.items.map(it => <li key={it.title} className="site-reveal"><h3 className="site-h4">{it.title}</h3><p className="site-body">{it.text}</p></li>)}</ul>
        </div>
      </section>

      <section id="contacto" className="site-section site-contact-band" aria-labelledby="contacto-title">
        <div className="site-wrap site-contact">
          <PikasMascot id="FND-03" size={176} animated className="site-contact-mascot" />
          <div>
            <p className="site-eyebrow">{contact.eyebrow}</p>
            <h2 id="contacto-title" className="site-h2">{contact.title}</h2>
            <p className="site-lede">{contact.lede}</p>
            <div className="site-cta-row">
              {contactEmail
                ? <><a className="site-btn site-btn-primary" href={`mailto:${contactEmail}?subject=${encodeURIComponent("Quiero conocer PIKAS")}`}>{contact.write}</a><span className="site-contact-address">{contactEmail}</span></>
                : <p className="site-body site-contact-fallback">{contact.fallback}</p>}
            </div>
            <p className="site-body">{contact.already} <Link className="site-link" href="/login">Inicia sesión</Link></p>
          </div>
        </div>
      </section>
    </main>

    <footer className="site-footer">
      <div className="site-wrap site-footer-grid">
        <div>
          <BrandLogo className="h-auto w-28" />
          <p className="site-footer-line">{footer.line}</p>
        </div>
        <nav aria-label="Pie de página" className="site-footer-nav">
          {site.nav.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
          <Link href="/login">{site.signIn}</Link>
        </nav>
      </div>
      <div className="site-wrap site-footer-legal">
        <p>{footer.copyright}</p>
        <p>{footer.credit}</p>
      </div>
    </footer>
  </div>;
}

import Link from "next/link";
import {ArrowRight, ShieldCheck, HeartPulse, Utensils, WalletCards} from "@/components/icons";
import {BrandLogo} from "@/components/brand-logo";

const benefits = [
  [WalletCards, "Compras sin efectivo", "Consulta el saldo y el historial sin manejar efectivo."],
  [ShieldCheck, "Controles familiares", "Define límites y productos bloqueados con claridad."],
  [HeartPulse, "Cuidado alimentario", "Registra alergias para advertir antes de una preorden."],
  [Utensils, "Preórdenes escolares", "Elige el menú y sigue el estado del pedido."],
] as const;

export default function Home() {
  return <div className="min-h-screen bg-white">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
      <Link href="/" className="flex min-h-11 items-center" aria-label="PIKAS, inicio"><BrandLogo priority className="h-auto w-32 sm:w-36"/></Link>
      <nav className="flex items-center gap-3" aria-label="Navegación pública">
        <a href="#como-funciona" className="hidden min-h-11 items-center font-semibold text-slate-600 sm:flex">Cómo funciona</a>
        <Link className="btn" href="/login">Iniciar sesión</Link>
      </nav>
    </header>
    <main>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-5 py-12 lg:grid-cols-2 lg:py-16">
          <div>
            <span className="chip bg-blue-50 text-blue-700">La vida escolar, mejor conectada</span>
            <h1 className="mt-4 text-4xl font-black leading-tight text-blue-950 sm:text-5xl">Más autonomía para estudiantes. Más tranquilidad para familias.</h1>
            <p className="mt-4 max-w-xl text-lg leading-7 text-slate-600">PIKAS reúne compras escolares sin efectivo, controles de alimentación, preórdenes y hábitos de presupuesto en un solo lugar.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login" className="btn">Entrar a PIKAS <ArrowRight size={18}/></Link>
              <a href="#experiencias" className="btn-secondary">Conocer la experiencia</a>
            </div>
          </div>
          <div className="relative rounded-3xl bg-pikas-navy p-4 shadow-lg">
            <div className="rounded-2xl bg-violet-50 p-5">
              <div className="flex justify-between gap-4">
                <div><p className="text-sm font-bold text-violet-700">Hola, Sofi</p><p className="text-3xl font-black">RD$2,450</p><small>Saldo disponible</small></div>
                <BrandLogo compact className="size-12 rounded-xl bg-white p-1.5"/>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="card p-3"><small>Para hoy</small><strong className="block text-lg">RD$190</strong></div>
                <div className="card p-3"><small>Próximo pedido</small><strong className="block">Pasta · 12:30</strong></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section id="como-funciona" className="bg-slate-50 py-14">
        <div className="mx-auto max-w-7xl px-5">
          <span className="label text-pikas-teal-dark">Un registro, tres experiencias</span>
          <h2 className="mt-2 max-w-2xl text-3xl font-black">Todo lo importante del día escolar, visible y fácil de manejar.</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {benefits.map(([Icon, title, copy]) => <article className="card p-5" key={title}>
              <Icon className="text-blue-700"/>
              <h3 className="mt-4 text-lg font-black">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
            </article>)}
          </div>
        </div>
      </section>
      <section id="experiencias" className="mx-auto grid max-w-7xl gap-5 px-5 py-14 md:grid-cols-2">
        <article className="rounded-2xl bg-blue-900 p-6 text-white"><span className="text-sm font-bold text-blue-200">PARA FAMILIAS</span><h2 className="mt-2 text-2xl font-black">Visibilidad sin complicaciones</h2><p className="mt-3 text-blue-100">Saldos, límites, alertas, estudiantes y pedidos comparten una única fuente de información.</p></article>
        <article className="rounded-2xl bg-violet-700 p-6 text-white"><span className="text-sm font-bold text-violet-200">PARA ESTUDIANTES</span><h2 className="mt-2 text-2xl font-black">Tu día, a tu alcance</h2><p className="mt-3 text-violet-100">Una vista móvil, clara y rápida para comprar, planificar y aprender a organizar el dinero.</p></article>
      </section>
    </main>
    <footer className="border-t px-5 py-6 text-center text-sm text-slate-500">PIKAS · Experiencia de demostración. No procesa dinero real.</footer>
  </div>;
}

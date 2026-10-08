import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { isDemoMode } from "@/lib/env";

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isDemoMode()) redirect("/login");

  const { error } = await searchParams;
  const messages: Record<string, string> = {
    config: "Supabase no está configurado para el proyecto autorizado.",
    identity: "La cuenta Auth no está vinculada a una Persona activa.",
    membership: "La Persona no tiene una membresía activa autorizada.",
    credentials: "No se pudo validar el correo y la contraseña.",
  };
  const message = error ? messages[error] ?? "La cuenta no tiene acceso PIKAS autorizado." : null;

  return (
    <main className="grid min-h-screen place-items-center bg-pikas-navy p-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <Link href="/" aria-label="PIKAS, inicio">
          <BrandLogo className="h-auto w-36" priority />
        </Link>
        <span className="label mt-6 block">Acceso secundario</span>
        <h1 className="mt-2 text-3xl font-black">Administración PIKAS</h1>
        <p className="mt-2 text-sm text-slate-600">
          Entrada de demostración para administración escolar, cafetería y
          personal POS.
        </p>
        {message && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800"
          >
            {message}
          </p>
        )}
        <form
          action="/api/auth/admin-login"
          method="post"
          className="mt-6 space-y-4"
        >
          <label className="block font-bold">
            Correo demo
            <input
              className="field mt-2"
              name="identifier"
              type="email"
              defaultValue="admin.escuela@demo.pikas.do"
              autoComplete="username"
              required
            />
          </label>
          <label className="block font-bold">
            Contraseña
            <input
              className="field mt-2"
              name="password"
              type="password"
              defaultValue="pikas-demo"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn w-full">Entrar a administración</button>
        </form>
        <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          Usa únicamente identidades ficticias de desarrollo o demostración.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 items-center font-bold text-blue-700"
        >
          Volver a accesos principales
        </Link>
        <p className="mt-4 text-center text-xs font-semibold text-slate-500">
          PIKAS es diseñada y desarrollada por Palmchat Innovations LLC.
        </p>
      </section>
    </main>
  );
}

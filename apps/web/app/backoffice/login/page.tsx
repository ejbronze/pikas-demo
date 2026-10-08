import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { isDemoMode } from "@/lib/env";

const messages: Record<string, string> = {
  unavailable: "El acceso al backoffice no está disponible en modo demo.",
  credentials: "No se pudo validar el correo y la contraseña.",
  identity: "La cuenta Auth no está vinculada a una Persona activa.",
  platform: "La cuenta no tiene autorización activa de plataforma.",
};

export default async function BackofficeLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (isDemoMode()) redirect("/");

  const { error } = await searchParams;
  const message = error ? messages[error] ?? messages.platform : null;

  return (
    <main className="grid min-h-screen place-items-center bg-pikas-navy p-4">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <Link href="/" aria-label="PIKAS, inicio">
          <BrandLogo className="h-auto w-36" priority />
        </Link>
        <span className="label mt-6 block">Acceso privado</span>
        <h1 className="mt-2 text-3xl font-black">PIKAS Backoffice</h1>
        <p className="mt-2 text-sm text-slate-600">
          Acceso exclusivo para operadores PIKAS con autorización activa de
          plataforma.
        </p>
        {message && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
            {message}
          </p>
        )}
        <form
          action="/api/auth/backoffice-login"
          method="post"
          className="mt-6 space-y-4"
        >
          <label className="block font-bold">
            Correo PIKAS
            <input
              className="field mt-2"
              name="identifier"
              type="email"
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
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn w-full">Entrar al backoffice</button>
        </form>
      </section>
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown, key: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Success only triggers a server refresh; the UI never assumes the new state locally.
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(url: string, body: unknown) {
    setBusy(true);
    setFailed(false);
    const ok = await post(url, body, crypto.randomUUID());
    if (ok) router.refresh();
    else setFailed(true);
    setBusy(false);
  }
  return { busy, failed, run };
}

const errorText = "No se pudo completar la acción. Inténtalo de nuevo.";

export function EnterCashierButton({
  accountId,
  cafeteriaId,
}: {
  accountId: string;
  cafeteriaId: string;
}) {
  const { busy, failed, run } = useAction();
  return (
    <div>
      <button
        className="btn w-full sm:w-auto"
        disabled={busy}
        onClick={() =>
          run("/api/platform/sandbox-pov/enter", { accountId, cafeteriaId })
        }
      >
        {busy ? "Entrando…" : "Entrar como Cajero"}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

export function ExitDemoButton() {
  const { busy, failed, run } = useAction();
  return (
    <div>
      <button
        className="btn-secondary w-full sm:w-auto"
        disabled={busy}
        onClick={() => run("/api/platform/sandbox-pov/exit", {})}
      >
        {busy ? "Saliendo…" : "Salir de demostración"}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

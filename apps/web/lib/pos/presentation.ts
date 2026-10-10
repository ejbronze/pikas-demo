"use client";

import { useState, useSyncExternalStore } from "react";

export type CatalogView = "gallery" | "list";
export const catalogViewKey = (actorPersonId: string) => `pikas:connected-pos:catalog-view:v1:${actorPersonId}`;
const subscribe = () => () => {};
const serverView = (): CatalogView => "list";

function readView(key: string): CatalogView {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === "gallery" ? "gallery" : "list";
  } catch {
    return "list";
  }
}

// A visual preference only: the identity comes from the already-authoritative POS context.
export function useCatalogView(actorPersonId: string): [CatalogView, (view: CatalogView) => void] {
  const key = catalogViewKey(actorPersonId);
  const [choice, setChoice] = useState<{ key: string; view: CatalogView } | null>(null);
  const view = useSyncExternalStore(subscribe,
    () => choice?.key === key ? choice.view : readView(key), serverView);
  const choose = (next: CatalogView) => {
    setChoice({ key, view: next });
    try { window.localStorage.setItem(key, next); } catch { /* Keep the current UI usable without persistence. */ }
  };
  return [view, choose];
}

export function formatReceiptTimestamp(timestamp: string | null | undefined, timeZone: string | null | undefined): string {
  if (!timestamp || !timeZone) return "Fecha no disponible";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  try {
    const day = new Intl.DateTimeFormat("es-DO", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
    const time = new Intl.DateTimeFormat("es-DO", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
    return `${day} · ${time}`;
  } catch {
    return "Fecha no disponible";
  }
}

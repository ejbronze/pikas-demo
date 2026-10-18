'use client';
import type { CloseRequest } from './operations';

// Same-origin Phase 5A operations call. Close requests carry their journal key as Idempotency-Key;
// a non-OK response throws with `definite` exactly as the route classifies it.
export async function operationsRequest(body: unknown) { const response = await fetch('/api/cafeteria/operations', { method: 'POST', headers: { 'Content-Type': 'application/json', ...((body as CloseRequest).request_key ? { 'Idempotency-Key': (body as CloseRequest).request_key } : {}) }, body: JSON.stringify(body) }); if (!response.ok) {
    const payload = await response.json();
    throw Object.assign(Error('No se pudo confirmar la operación con tus permisos actuales.'), { definite: payload.definite === true });
} return (await response.json()).result; }

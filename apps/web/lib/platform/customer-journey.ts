import { z } from "zod";
import { customerDraftSchema, provisionResultSchema, prepareResultSchema, type CustomerDraft } from "./customer-contracts";

export const journeySchema = z.object({
  draft: customerDraftSchema, tenantKey: z.uuid(), adminKey: z.uuid(), expiresAt: z.iso.datetime(),
  tenant: provisionResultSchema.nullable(), administrator: prepareResultSchema.nullable(),
});
export type CustomerJourneyState = z.infer<typeof journeySchema>;
type Journal = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Send = (path: string, key: string, body: unknown) => Promise<unknown>;
export const journeyStorageKey = (actor: string) => `pikas:customer-provisioning:v1:${actor}`;

export async function postPlatform(path: string, key: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "authorization" : response.status === 409 ? "conflict" : "unavailable");
  return response.json();
}

// This journal preserves request identity only; the server independently authorizes every request.
export class CustomerJourney {
  private busy = false;
  constructor(public state: CustomerJourneyState, private storage: Journal, private storageKey: string, private send: Send = postPlatform) {}
  static restore(storage: Journal, storageKey: string, send?: Send) {
    const saved = storage.getItem(storageKey);
    return saved === null ? null : new CustomerJourney(journeySchema.parse(JSON.parse(saved)), storage, storageKey, send);
  }
  static create(draft: CustomerDraft, storage: Journal, storageKey: string, send?: Send) {
    if (storage.getItem(storageKey) !== null) throw new Error("recovery_required");
    const state: CustomerJourneyState = { draft: customerDraftSchema.parse(draft), tenantKey: crypto.randomUUID(), adminKey: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), tenant: null, administrator: null };
    storage.setItem(storageKey, JSON.stringify(state)); // Persist before sending any write.
    return new CustomerJourney(state, storage, storageKey, send);
  }
  async run() {
    if (this.busy) throw new Error("busy");
    this.busy = true;
    try {
      if (!this.state.tenant) {
        const tenantPayload = customerDraftSchema.omit({ administratorName: true, administratorEmail: true }).strip().parse(this.state.draft);
        const response = z.object({ result: provisionResultSchema }).parse(await this.send("/api/platform/tenants", this.state.tenantKey, tenantPayload));
        this.state = { ...this.state, tenant: response.result };
        this.storage.setItem(this.storageKey, JSON.stringify(this.state));
      }
      if (!this.state.administrator) {
        const response = z.object({ result: prepareResultSchema }).parse(await this.send("/api/platform/customer-admins/prepare", this.state.adminKey, {
          accountId: this.state.tenant!.account_id, scopeKind: "account", schoolId: null, cafeteriaId: null, roleCode: "account_admin",
          intendedEmail: this.state.draft.administratorEmail, expiresAt: this.state.expiresAt,
        }));
        this.state = { ...this.state, administrator: response.result };
        this.storage.setItem(this.storageKey, JSON.stringify(this.state));
      }
      return this.state;
    } finally { this.busy = false; }
  }
  finish() {
    if (!this.state.tenant || !this.state.administrator) throw new Error("unfinished");
    this.storage.removeItem(this.storageKey);
  }
}

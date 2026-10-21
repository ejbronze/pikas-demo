import { sessionFetch } from "../auth/session-fetch";
import { z } from "zod";
import { onboardResultSchema, prepareResultSchema, schoolOnboardingDraftSchema, schoolOnboardingSchema, type SchoolOnboardingDraft } from "./customer-contracts";
import { isUsernameRejection } from "../identity/provisioning";

export const journeySchema = z.object({
  draft: schoolOnboardingDraftSchema, tenantKey: z.uuid(), adminKey: z.uuid(), expiresAt: z.iso.datetime(),
  tenant: onboardResultSchema.nullable(), administrator: prepareResultSchema.nullable(),
});
export type CustomerJourneyState = z.infer<typeof journeySchema>;
type Journal = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Send = (path: string, key: string, body: unknown) => Promise<unknown>;
// v2: Agregar colegio. A v1 journal (manual codes) is never resent by this flow.
export const journeyStorageKey = (actor: string) => `pikas:school-onboarding:v2:${actor}`;

export async function postPlatform(path: string, key: string, body: unknown): Promise<unknown> {
  const response = await sessionFetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
  if (response.status === 422) { const body = await response.json().catch(() => ({})); if (isUsernameRejection(body.error)) throw new Error(`username:${body.error}`); }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "authorization" : response.status === 409 ? "conflict" : "unavailable");
  return response.json();
}

// Two independent transactional commands, never presented as one atomic write: (1) colegio
// onboarding creates the customer, colegio, first sede and cafetería together; (2) the existing
// Phase 6A intent prepares the colegio's initial administrator. The journal keeps each request's
// key and payload so a retry resends exactly the unconfirmed step; the server authorizes each one.
export class CustomerJourney {
  private busy = false;
  constructor(public state: CustomerJourneyState, private storage: Journal, private storageKey: string, private send: Send = postPlatform) {}
  static restore(storage: Journal, storageKey: string, send?: Send) {
    const saved = storage.getItem(storageKey);
    return saved === null ? null : new CustomerJourney(journeySchema.parse(JSON.parse(saved)), storage, storageKey, send);
  }
  static create(draft: SchoolOnboardingDraft, storage: Journal, storageKey: string, send?: Send) {
    if (storage.getItem(storageKey) !== null) throw new Error("recovery_required");
    const state: CustomerJourneyState = { draft: schoolOnboardingDraftSchema.parse(draft), tenantKey: crypto.randomUUID(), adminKey: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), tenant: null, administrator: null };
    storage.setItem(storageKey, JSON.stringify(state)); // Persist before sending any write.
    return new CustomerJourney(state, storage, storageKey, send);
  }
  async run() {
    if (this.busy) throw new Error("busy");
    this.busy = true;
    try {
      if (!this.state.tenant) {
        const schoolPayload = schoolOnboardingSchema.parse({ schoolName: this.state.draft.schoolName, taxId: this.state.draft.taxId,
          addressLine: this.state.draft.addressLine, countryCode: this.state.draft.countryCode, provinceCode: this.state.draft.provinceCode });
        const response = z.object({ result: onboardResultSchema }).parse(await this.send("/api/platform/schools/onboard", this.state.tenantKey, schoolPayload));
        this.state = { ...this.state, tenant: response.result };
        this.storage.setItem(this.storageKey, JSON.stringify(this.state));
      }
      if (!this.state.administrator) {
        // The accepted initial-administrator contract: account scope, which for a one-colegio
        // customer is the colegio's School Admin (students, padres and staff).
        const response = z.object({ result: prepareResultSchema }).parse(await this.send("/api/platform/customer-admins/prepare", this.state.adminKey, {
          accountId: this.state.tenant!.account_id, scopeKind: "account", schoolId: null, cafeteriaId: null, roleCode: "account_admin",
          intendedEmail: this.state.draft.administratorEmail, expiresAt: this.state.expiresAt, intendedUsername: this.state.draft.administratorUsername,
          intendedDisplayName: this.state.draft.administratorName,
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

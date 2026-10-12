# 4D.5 account activation: surgical security remediation

Uncommitted local implementation. HEAD remains `9fb2b83263afc88382fef5416f44f2b480b1d18c`. No production, email delivery, staging, commit, push or deployment is authorized by this phase.

## C1: independent application credential

The former application binding hashed Supabase's native `hashed_token`, whose apparent hash length does not establish entropy: the reviewed provider derives it from an email and numeric OTP. The anonymous preview could validate candidate hashes outside Auth verification limits.

The application now generates **32 independent CSPRNG bytes** with Node `randomBytes(32)`, encoded as exactly 64 hexadecimal characters. The database stores only their SHA-256 digest. This credential does not derive from the email, native OTP/hash, prepared handle or Auth UUID. No native token is returned to the browser. The application credential is delivered in `/activar#token=…`; the page removes the fragment from history and retains it only in component memory. No credential is written to the existing command journal or persistent browser storage.

`activation_preview` accepts only the digest of this independent credential and returns only the opaque invitation handle, never recipient email, Auth UUID or ownership metadata. Random, malformed, expired, revoked, unrelated and finalized credentials return null. A consumed invitation remains recoverable only while the exact owned identity is password-pending. Knowing an email and all public handles does not reveal the 256-bit application credential: native OTP enumeration has no corresponding application binding. The focused SQL test checks all 1,000,000 six-digit native candidates against the independent binding; integration tests also submit actual native hashes to preview and receive null.

Expiry remains the minimum of one hour and the prepared-intent expiry. Every successful reissue binds a new random credential and explicitly revokes the previous application invitations in the same flow. Source, flow, invitation and Auth locks use a consistent order; expiry is rechecked after Auth waits.

## I1: identity ownership and safe reissue

A private flow row binds exactly one source kind/handle/email and a random 256-bit provenance marker. The marker is written only to **server-controlled Auth app_metadata**, not user_metadata. Private SQL inspects existing Auth state before permitting issuance. An unknown identity, including an unconfirmed identity, is never adopted solely because its email matches.

The server creates an absent identity with native `auth.admin.createUser`, confirmation disabled and the flow marker attached. It does not use `generateLink(invite)` to create/adopt an unknown email. Unique-email conflicts fail closed. A subsequent privileged lookup attaches the exact UUID only if its marker, email and eligibility match the existing flow. Thus a lost createUser response can be reconciled without another identity. The service-role client calls native `getUserById` and validates the marker/UUID/email before every native invite or recovery-link generation.

Only a compatible, unlinked, activation-owned identity with password setup still pending can be reissued/resumed. Unrelated unconfirmed users, preexisting confirmed users, banned/deleted/anonymous users, mismatched UUID/metadata/email and any already-linked Person fail closed. A flow-owned identity confirmed by an interrupted activation may resume until password setup closes. Ready identities use ordinary login and the unchanged completion contract, never another invitation-based password reset. No Auth UUID or provenance marker is added to application JSON/UI props; ordinary Auth cookies still contain the recipient's normal session identity.

`activation_provider_context` is a narrow service-role RPC. It exposes only the exact live reservation's owned provider context, with no table access or authorization grants. A second narrow service-role RPC releases a pending password fingerprint only after the endpoint receives a definitive native weak-password rejection; recipient roles cannot call that release directly. Issuing and binding still require the real authorized platform actor and existing `platform:team:manage` gate. No browser-supplied email, UUID, source kind, role or redirect is accepted.

## I2: explicit recoverable state

Auth, database and HTTP cookies are **not one atomic transaction**. Recovery is represented by existing provider state plus private flow/invitation state:

| State | Evidence | Safe next operation |
| --- | --- | --- |
| Prepared | Existing frozen pending intent | Authorized administrator issues a link |
| Issued | Owned Auth UUID, application digest, expiry | Recipient explicitly activates |
| Identity confirmed / password pending | Auth confirmation; once-only consumed/audit timestamp may already exist | Same valid private link obtains a new session for the same owned UUID |
| Password operation pending | Immutable keyed fingerprint of first submitted password | Retry the same password |
| Identity ready | Auth password differs from recorded initial baseline; ready timestamp is reconciled | Ordinary login; administrator completes access |

After authenticating the high-entropy application credential, the server inspects the exact owned Auth user. It generates a native invite for an unconfirmed owned user or a native magic link for a confirmed password-pending owned user, then verifies it using an isolated public Auth client. These native tokens never leave the server, are not persisted or logged, and send no email. A failed concurrent native exchange can retry the same application link; it cannot create another identity or authority.

Opening the page performs no activation. Explicit activation ignores incoming inviter cookies; only successful recipient verification/consume/session persistence installs recipient cookies. This replaces the account across tabs in that browser; the private-window warning remains. No recovery request executes as Edwin.

| Interruption | Recovery |
| --- | --- |
| Before native verification | Retry the same still-valid link |
| Native verification succeeded; consume failed or response lost | Same link verifies a new session for the same confirmed owned identity and retries consume |
| Consume succeeded; cookie/HTTP response lost | Same link restores a recipient session; consume is idempotent and audit remains once-only |
| Reload before password | Opaque invitation query plus existing recipient cookies resumes password setup; if cookies were lost, reopen the original privately delivered link |
| Password succeeded; finalization/success response lost | Password-state lookup recognizes the changed Auth baseline, returns ready and does not write another password; ordinary login also works |
| Activation repeated after confirmation | Safely resumes while password-pending; finalized links return invalid |
| Authorized reissue after interruption | Same provenance/UUID, new application credential, old credentials revoked |

Recovery is bounded by the original link's expiry, compatible prepared state and password finalization. It requires no email delivery, dashboard access or developer intervention while the credential is live. The recipient should retain the original privately delivered link until password setup completes. No automatic recipient email is claimed or sent.

## Password finalization

Native createUser supplies an initial provider password hash even when the application supplies no password. Therefore a nonempty encrypted_password is **not** evidence of recipient setup. The flow records only a SHA-256 digest of this initial provider hash, not the password or raw hash. A subsequent Auth hash change closes recovery/password setup immediately, even before ready-at/audit reconciliation returns.

The endpoint verifies the current recipient with getUser and exact consumed reservation ownership. Passwords (10–128 characters plus provider policy) go only to the recipient's native updateUser API, never SQL or logs. An HMAC fingerprint keyed by the flow marker binds uncertain/concurrent retries to the same first-password payload; neither plaintext password nor an unkeyed password digest is persisted. Another first-password payload is rejected while the result is uncertain. A definitive native weak_password rejection releases only that matching pending payload so a stronger password can be chosen; network/unknown outcomes never release it. A ready response performs no password write. Recipient-only finalization can reconcile ready state after a lost response without granting authority.

## Authority and frozen scope

Activation creates/controls Auth identity only. It never creates Person, account/school/cafeteria membership, platform_admin, platform_sandbox_operator, cashier membership or register assignments. For flow-owned identities, the UI's identity_ready indicator additionally waits for password setup. It is an indicator, not an authorization gate replacement.

Only frozen `platform_team_command('complete')` can link/create Person (line 93), grant platform_admin (line 94), and separately grant platform_sandbox_operator when selected (line 95). Existing team-command request-key recovery remains intact. An old pending completion retry also waits for password readiness while its intent is pending, preserving the exact saved key/payload; completed-intent replays remain available. No contract through `202610100004` is edited. Existing global current_person_id, sandbox launcher, Horizonte, Edwin's authority and Oscar's prepared production record are untouched. Only the platform-team issuer is wired; generic source validation does not expose future source issuers.

## Private-link Beta model and deployment

Possession of the private application link is entitlement to establish the intended identity. It **does not independently prove mailbox possession**. UI says "Identidad activada", requires private trusted delivery, explains no email was sent and retains the administrator's mandatory completion step. This is a temporary Beta workflow subject to independent security re-review.

Required server-only configuration remains exact HTTPS PIKAS_APP_ORIGIN and SUPABASE_SERVICE_ROLE_KEY, plus the existing approved project configuration. Missing configuration fails closed. The service-role helper is server-only with no cookie/session persistence; it performs narrow owned-identity create/inspect/invite/magiclink operations and the provider-context RPC, never tenant writes or authority grants. Production provider version, Auth policy and environment activation still require separately authorized checks; this phase does not configure them.

## Focused validation

Use only the isolated `pikas-activation` profile, synthetic example.invalid identities, local Docker and ports 55541/55542. Normal config/wrapper and production remain untouched. Tests target credential separation, foreign-identity rejection, owned reissue, all seven interruption cases, real Auth/SSR/password login, finalization, zero activation authority and frozen manual completion/separate roles/shared synthetic sandbox behavior. Concurrency harness reuses only session helpers, never historical scenarios, and proves blocking with pg_blocking_pids.

Final-state results: 62 focused web tests; 61 pgTAP assertions (including all one million native OTP candidates); real local Auth/SSR integration covering all seven interruption states, foreign-identity rejection, ordinary password login and frozen completion/shared synthetic sandbox; seven independent-session races with observed blocking all passed. Web typecheck, affected ESLint, shell/JS/Python syntax checks and Git whitespace checks passed. All 34 tracked migration/archive/config/wrapper files were byte-identical to HEAD. DB lint completed with no warnings or schema errors. Final synthetic-fixture cleanup and isolated-profile shutdown are completed before the final report. No historical suites or production operations ran.

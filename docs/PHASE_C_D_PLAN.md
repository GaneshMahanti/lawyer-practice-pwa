# VakilDesk - Phase C and D build plan (AI credits, UPI payments, developer controls, team seats)

For Claude Code. Read `AGENTS.md` and `CLAUDE.md` first (this repo uses Next.js 16: check
`node_modules/next/dist/docs/` before writing framework code). Do not invent APIs: where this
plan says VERIFY, read the installed package source or docs before relying on it.
Last updated: 21 Sep 2026. Deadline: everything in place by 1 Oct 2026.

## STATUS - READ THIS FIRST

### What is DONE (do not rebuild; extend it)
| Area | State | Where |
|---|---|---|
| Phase A: roles, auth on AI routes, theme switch, modal fix, solid header | DONE | earlier |
| Phase B: push hearing reminders, IST hearing time, short invite links, error_logs | DONE (reminder timer NOT yet scheduled: pg_cron/pg_net not installed) | `src/lib/push/*`, `src/lib/reminders/*` |
| Newest-login-wins device control | DONE | `src/lib/auth/deviceSession.ts` |
| Verified onboarding (email + phone must match developer's record) | DONE | `/api/onboarding/complete` |
| C0 security fixes (portal payNow, demo rate limit, short AI errors) | DONE | Claude Code |
| C1 database: wallets, ledger, payment_requests, config, money functions | DONE, applied and tested on the live DB | `supabase/migration_phase8_credits_payments.sql` |
| C2 metering on voice / translate / transliterate / OCR | DONE | `src/lib/ai/metering.ts` |
| Developer's OWN AI use: free of wallets, logged as `internal_usage` | DONE | `metering.ts` (`isDeveloperActor`) |
| C4a Developer screen: see every lawyer's balances + usage, and CONTROL them | DONE (deploy needed) | see below |
| Sarvam balance: record from dashboard + running estimate | DONE (deploy needed) | see below |
| Service charge changed to 15% (`recharge_credit_percent` = 85) | DONE in the live DB | `app_config` |

C4a details (built by the developer's chat assistant, NOT by Claude Code; extend, do not duplicate):
- `src/components/AiUsageDeveloperCard.tsx`, rendered in `src/app/app/settings/page.tsx` (developer block).
- `GET /api/admin/ai-usage?period=month|all`  (read-only report; uses SQL `admin_ai_usage_report`)
- `POST /api/admin/ai-credits`  actions: `grant_included` (app fee received, Rs 1,000 once),
  `adjust` (add/remove credits, bucket included|purchased, required note, max Rs 10,000 per action),
  `set_status` (pause/resume a wallet), `set_daily_cap`. Money changes go through SQL
  `admin_adjust_credits` / `grant_included_credits`; the route never edits balances directly.
- `POST /api/admin/sarvam-balance`  records the number typed from the Sarvam dashboard.
  Sarvam has no balance API, so: estimate = latest snapshot - metered cost since (lawyer net usage +
  developer internal usage). The card warns when estimate < recharged credits owed to lawyers.
- Migrations applied to the live project: phase7_onboarding_verify, phase8_demo_rate_limit,
  phase8_credits_payments (corrected), phase9_admin_ai_report, phase10_admin_credit_controls.
  The next migration file is `migration_phase11_*.sql`. The developer's assistant applies SQL through the
  Supabase connector; you write the file and ask.
- Live facts: Sarvam balance recorded Rs 62.08 on 21 Sep 2026 (testing money). "Ganesh 2" is the developer's
  OWN test lawyer account. NO credits are pre-loaded for anyone (see "No credits before payment" below).

### What is STILL TO BUILD, in this order (commit and push after each step)
1. **C3 Lawyer wallet screen** (Settings -> "AI credits") - not started.
2. **C5 UPI recharge flow** (lawyer creates request, pays, submits UTR) - not started.
3. **C4b Developer payments inbox** (approve/reject, received list, "to top up on Sarvam", config and
   rate-card editing, push alert) - not started.
4. **Bug fixes** found in review (small, do first if convenient): see "Known bugs" below.
5. **D1 Team seats**, then **D2 leftovers** (IP/city + swap flags + reset devices), then **C6/D3 tests**.
If time runs short, cut in this order: D2 leftovers, seat renewals, config/rate-card editing UI.
NEVER cut: C3, C5, C4b approval, the zero-balance stop.

### Known bugs to fix
- `src/app/api/ocr/enhanced/route.ts`, JSON handler: if an exception happens AFTER `reserve()` the
  `catch` only logs, so the reservation is never released (credits leak). Release in the catch (the
  multipart handler already does).
- `voice/transcribe` and `ocr/enhanced` authenticate with `getRequestUser` instead of
  `requireWorkspaceUser`, so the one-active-device rule is not enforced on them. Switch them.
- `voice/transcribe` returns a 503 message that names the env var and Vercel settings. Make it short and
  log the detail (like the other routes).
- The reminder timer is not scheduled (heartbeat is empty). Ask the developer before setting it up; it
  needs his CRON_SECRET.

## NO CREDITS BEFORE PAYMENT (decided by the developer, 21 Sep 2026)
- The Rs 1,000 Included credits are added ONLY after the developer has received the lawyer's one-time app
  payment (he presses "App fee received"). Recharged credits are added ONLY after he approves a payment he
  has actually received. Nothing is ever granted in advance, automatically, or on sign-in.
- The only ways credits ever change: (1) "App fee received" button, (2) approved recharge, (3) developer
  adjustment with a written note (for example a cash payment, or a small amount for testing).
- "Ganesh 2" is the developer himself, used to test the lawyer app. It has NO wallet right now. The Rs 62.08
  Sarvam balance is testing money, not a promise to anyone. There is therefore no "unfunded promise" and
  no low-Sarvam-balance warning to raise today. Do not add warnings, banners or messages about it.
- To test lawyer-side screens with Ganesh 2 before real payments: use the developer card's "Add / remove
  credits" with a small amount (for example Rs 20) and the note "test", then remove it afterwards; or,
  once C5 exists, do a real Rs 100 recharge to his own UPI (Rs 85 credited). Never auto-create a wallet.
- The Sarvam-balance warning in the developer card compares the balance with RECHARGED credits only
  (credits customers have paid for). Included credits are never counted.

## CONFIRMED BY THE DEVELOPER
- Recharge: minimum Rs 100. **15% service charge: the lawyer receives 85%** of the amount the developer
  confirms as received (Rs 100 -> Rs 85). Value lives in `app_config.recharge_credit_percent` (= 85);
  NEVER hardcode 85 or 15 in code or UI text; read it from config.
- Extra login (PA / assisting lawyer): Rs 5,000 one-time + Rs 1,000 per year
  (`seat_price_paise=500000`, `seat_renewal_paise=100000`).
- Sarvam rates: dictation Rs 30/hour, translation and script conversion Rs 20 per 10,000 characters,
  OCR Rs 0.5/page (in `ai_rate_card`). Confirmed against his Sarvam dashboard usage page.
- UPI payee name and VPA are in `app_config` (`upi_vpa`, `upi_payee_name`) in the live DB only.
  **THE GITHUB REPO IS PUBLIC: never write the VPA, payee name or a QR image into any committed file,
  migration, test or seed.** Use obviously fake values in tests. No static QR image is needed: build the
  QR in the browser from `upi://pay?...`; also show the VPA as text.

## Working rules
- New branch; commit and push after EACH numbered step.
- SQL goes in `supabase/migration_phase11_*.sql` files. Ask the developer before anything is applied.
  Never print or commit secrets. Never ask for a GitHub token.
- Keep every test in `scripts/` passing (`test-auth.js` asserts strings in `src/middleware.ts`; scenario 8
  there was already stale before this work - report, do not "fix" it silently).
- Users only see short, plain error messages; details go to `logServerError` (always `await` it).
- Money is integer paise. Money writes only through the SECURITY DEFINER functions or server routes with
  the service client. Lawyers never get write access to wallet, ledger, payment or seat tables.
- Roles come only from `app_metadata`. Developer-only routes use `requireDeveloperUser`; lawyer routes
  use `requireRealAppUser` (enforces the active device). Demo accounts never touch wallets or payments.

## Product rules
1. Credits are shown in rupees and equal Sarvam cost 1:1.
2. Two separate buckets per workspace, always shown separately:
   - Included: Rs 1,000, granted ONCE when the developer marks the app fee received; valid 12 months;
     spent FIRST. Recharged: bought credits, never expire, spent after Included.
3. Recharge: lawyer pays Rs P by UPI; after the developer approves, credits = floor(received x percent/100).
   The lawyer UI states the rate plainly: "You pay Rs 100 - you get Rs 85 AI credits" (compute the 85 from
   config). Never show the full amount as credited. No "service charge" wording, but never hide the rate.
4. Direct UPI has no automatic confirmation: every payment is a request the developer approves after he
   sees the money in his own bank/UPI app. He types the amount received; credits use THAT number.
5. Lawyers see only their own wallet, usage and payments. Only the developer sees the Sarvam balance,
   the 15% he keeps, other lawyers, and his own usage. Enforce in API responses, not just the UI.
6. The developer's own AI use is free of wallets and logged (`internal_usage`); he pays Sarvam directly.
7. One active device per login (developer and demo exempt). Team seat = second Google login that sees ALL
   of the paying lawyer's data.

---------------------------------------------------------------------------------------------------
## PHASE C - remaining work

### C3. Lawyer screen: Settings -> "AI credits" (workspace OWNER; demo hidden)
Add `src/components/AiCreditsCard.tsx` (render it for real lawyers in `settings/page.tsx`, NOT for the
developer, who already has the developer card) and `GET /api/ai/wallet?period=month|all`
(`requireRealAppUser`, service client, scoped to the caller's workspace owner via `resolveOwner`).
The API returns ONLY: included (left, expires, expired flag), recharged left, wallet status, daily limit,
low-balance flag (`low_balance_paise`), usage for the period (rupees and plain units per feature:
dictation minutes, translated characters, OCR pages), the latest 50 activity rows (use plain wording:
"Used Dictation", "Credits added by support", "Recharge credited", "Refund"), the lawyer's own
`payment_requests` (status pending/approved/rejected, amount paid, credits received), the config numbers
needed for the recharge maths (`min_recharge_paise`, `recharge_credit_percent`) and the human-unit rate
card ("Rs 20 per 10,000 characters", "Rs 30 per hour", "Rs 0.50 per page"). It must NEVER return
`internal_usage` rows, other owners, `decided_by`, the Sarvam balance, or `admin_adjustment` notes
(show those rows as "Credits adjusted by support" without the note).
UI: two tiles (Included, Recharged, never merged), usage by feature, activity list, low-balance banner,
zero-balance stop message, a "Recharge" button (C5). Team members (Phase D) see balances but no Recharge.
Wallet reads for team members need `workspace_owner_of` (Phase D); for now owner only.

### C5. UPI recharge flow (lawyer)
- `POST /api/ai/recharge` {amountRupees}: min from config, whole rupees in multiples of Rs 10, max Rs 10,000;
  creates a `payment_requests` row (`kind='recharge'`, `status='created'`, `ref_code` "VD-" + 6 random
  uppercase alphanumerics, unique) using the SERVICE client (lawyers have no insert access). Returns the
  ref code, the amount, `upi://pay?pa=<VPA>&pn=<PAYEE>&am=<amount>&cu=INR&tn=<ref_code>` built from
  `app_config`, and the credits the lawyer will receive at the current percent.
- UI step 1: amount picker (Rs 100 / 200 / 500 / 1,000 / custom) showing "You pay Rs P - you get Rs X".
  Step 2: QR (browser-side QR library; VERIFY the licence and pick a small one) + "Pay with UPI app" button
  + the VPA and reference code as text + copy buttons. TEST on the developer's phone with GPay, PhonePe,
  Paytm: some apps restrict pre-filled amounts to personal UPI IDs; the text fallback must always work.
  Step 3: "I have paid" -> enter the 12-digit UTR.
- `POST /api/ai/recharge/submit` {requestId, utr}: owner only; UTR exactly 12 digits; unique (DB rejects
  duplicates - show "This reference was already used"); status `created` -> `submitted`,
  `submitted_at=now()`; then send a push to the developer (reuse `src/lib/push/server.ts`; find the
  developer's subscriptions by role). Requests not submitted within 48 hours become `expired`
  (mark on read, no timer needed). Rate-limit: max 5 open (created/submitted) requests per lawyer.
- Lawyer sees status: "Waiting for confirmation" -> "Credited" or "Not received - contact support".

### C4b. Developer payments inbox and remaining controls (extend `AiUsageDeveloperCard` or add a sibling)
- `GET /api/admin/payments` + `POST /api/admin/payments/decision` (developer only).
  Inbox = `submitted` requests: lawyer, amount expected, UTR, reference code, time. Approve field
  "amount received" (default = expected) calls SQL `approve_payment_request(id, received, developer_id)`;
  Reject (with note) calls `reject_payment_request`. The approval screen must say: "Approve only after you
  see this payment (amount + reference code or UTR) in your bank/UPI app." On approve the wallet updates
  and the lawyer sees the credits at once.
- Received list: lawyer, expected, received, credited, YOUR share (received - credited; derive it, never
  store it), UTR, date; totals for the month; filter by lawyer and month.
- "To top up on Sarvam": sum(credited by approved recharges) - sum(`sarvam_topups`), button "I added Rs N to
  Sarvam" (writes `sarvam_topups`) and prompt to update the Sarvam balance number afterwards. Show a red
  warning when Sarvam balance estimate < recharged credits owed (already computed by `ai-usage`).
- Editable config (developer only): `recharge_credit_percent`, `min_recharge_paise`, `included_credit_paise`,
  `low_balance_paise`, `daily_ai_cap_paise`, `upi_vpa`, `upi_payee_name`; and `ai_rate_card`. Validate ranges
  (percent 50-100, min recharge Rs 10-Rs 5,000, cap Rs 10-Rs 10,000). Never echo the UPI values into logs.
- "AI kill switch": one button pauses ALL wallets (`status='paused'`) and one resumes them.
- Payments and Sarvam data are developer-only; test that a lawyer session gets 403 on every `/api/admin/*`.

### C6. Tests for phase C
Plain Node scripts in `scripts/`: recharge maths at 85% with rounding (Rs 100 -> 8500 paise; Rs 10 ->
850); approve is idempotent and rejects duplicate UTR; lawyer wallet API never leaks internal usage,
other owners, admin notes or Sarvam data; a lawyer cannot create/approve requests for another owner;
demo user gets 403; developer usage never reduces any wallet; 402 at zero balance; percent read from config
(change it and the UI text and credits change).

---------------------------------------------------------------------------------------------------
## PHASE D - team seats and one-device limit

### D1. Team seat (PA / assisting lawyer)
Model: keep `owner_id` on every data row = the paying lawyer. A seat user works inside that workspace.
- Table `workspace_members(owner_id, member_user_id, member_email, role ['assistant','assisting_lawyer'],
  status [pending|active|revoked], seat_expires_at, created_at)`. A user is either an owner or a member.
- Function `workspace_owner_of(uid)` (STABLE SECURITY DEFINER): owner id if `uid` is an active member, else
  `uid`. REWRITE the RLS policies of every owner-scoped table (see `supabase/schema.sql` and later
  migrations) and the documents storage policies (VERIFY path prefixing) from `owner_id = auth.uid()` to
  `owner_id = public.workspace_owner_of(auth.uid())`. Check each table; do not assume. Extend the
  wallet/ledger/payment_requests SELECT policies the same way, and update `resolveOwner()` in
  `src/lib/ai/metering.ts` so members spend the owner's wallet.
- Client: `src/lib/data/workspace.ts` uses the signed-in user id as owner id. Resolve the workspace owner
  once at hydrate (new `/api/workspace/me`) and use it for every insert/upsert.
- Team screen in Settings (owner only): list members; "Add PA / assisting lawyer" (name, Google email,
  10-digit mobile, role) -> creates a `seat` payment request (same UPI flow as C5, amount from
  `seat_price_paise`) -> after developer approval the server inserts `approved_users` (role lawyer, same
  plan, phone stored) + member `active` + `seat_expires_at` = +1 year. Extend `approve_payment_request`
  for `seat` / `seat_renewal`. Owner can remove a member (revokes sessions). Renewal request 30 days before
  expiry.
- Members go through VERIFIED onboarding like any lawyer (that is why the phone is required). Their profile
  is their own; their DATA is the owner's workspace. They can use AI (shared wallet) and see balances, but
  cannot recharge, add/remove members, or change the owner's subscription.
- Push reminders: extend `src/lib/reminders/dispatch.ts` so active members' devices get the owner's reminders.
- Developer dashboard: seats per lawyer, seat expiry, revoke.

### D2. One active device per login
STATUS: CORE IS BUILT (`src/lib/auth/deviceSession.ts`, `/api/session/check`, `DeviceSessionGuard`,
enforced in `requireRealAppUser` / `requireWorkspaceUser`). Do NOT re-implement.
Still TO DO: record IP + Vercel city/country (VERIFY the `x-vercel-ip-*` headers), count device swaps for
the developer dashboard (flag 3+ swaps in 24h as "possible sharing"), and a "Reset devices" button.
Never hard-block on IP (mobile IPs change constantly in India).

### D3. Tests for phase D
Member reads/writes the owner's rows and nobody else's; a revoked member loses access at once; seat
purchase only takes effect after approval; reminders reach member devices; members spend the owner's wallet.

---------------------------------------------------------------------------------------------------
## Definition of done (developer's phone checklist)
1. Developer opens Settings -> "AI credits and usage": sees every lawyer's Included / Recharged balance,
   usage by feature, his own usage, and the Sarvam balance estimate. (DONE, needs deploy.)
2. Developer gives a lawyer credits (app fee Rs 1,000, or add/remove with a note); the lawyer sees them
   immediately. (Developer side DONE; lawyer screen = C3.)
3. Developer's own scan/translate works with no wallet and shows under "Your own AI use". (DONE.)
4. Lawyer sees "AI credits": two balances, usage by feature, activity. (C3)
5. Lawyer taps Recharge Rs 100 -> sees "you get Rs 85" -> pays by UPI -> enters UTR -> developer gets a
   push -> approves -> Rs 85 appears under Recharged; developer sees Rs 100 received, Rs 85 credited,
   Rs 15 his share. (C5 + C4b)
6. At Rs 0 the AI features stop with a clear "recharge" message. (C2 DONE)
7. Developer sees how much to top up on Sarvam and records the new balance. (C4b)
8. Lawyer buys a seat -> after approval the PA signs in with Google and sees every file. (D1)
9. A lawyer can never see the Sarvam balance, other lawyers, or any developer-only data.

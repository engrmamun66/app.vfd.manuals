# Payment, Subscription & Premium — Technical Document

Scope: everything that decides whether a user has Pro access and how money is recorded — free limits, free full-access period,
pricing plans, manual payment review, subscription time rules, migration, cancellation, payment ledger, Super Admin rules.

Code map: `server/src/services/premium.ts`, `server/src/routes/premium.ts` (user routes `/api/premium/*`, admin routes `/api/premium-admin/*`),
`server/src/routes/admin.ts` (users), `server/src/db/migrations.ts` (v11, v12, v15, v16),
`client/src/lib/premium.tsx`, `client/src/components/{PlansModal,SubmitPayment}.tsx`, `client/src/pages/PremiumAdmin.tsx`, `client/src/pages/PrivacyPolicy.tsx`.

---

## 1. Who has Pro? (`isPro`)

A user is Pro when **any** of these is true (`services/premium.ts → isPro`):

1. Role is `super_admin`.
2. An **active subscription** exists: `status='active'`, `deleted_at IS NULL`, `ends_at > now`, `starts_at <= now + 1 hour`
   (a start up to one hour ahead counts, because starts are rounded *up* to the next full hour).
3. A **free full-access period** is running: `users.full_access_until > now`.

Otherwise the user is **Free**. Expiry is evaluated on every request (no background job needed): when `ends_at` passes, `isPro` turns false by itself.

`GET /api/premium/status` returns: `isPro`, `plan` (`monthly|yearly|trial|admin|null`), `endsAt`, `trialEndsAt`, `subscription` (running one),
`queued` (paid next period), `needsPlanMigration`, `pricingPlans` (active), `pending` (draft), `profileComplete`, `config`, `usage`.

## 2. Free-user limits and locks (Premium Settings)

Stored in `app_settings.premium_config` (Super Admin → Premium Settings). Pro users and Super Admins are never limited.

| Setting | Effect for Free users |
|---|---|
| `locked_menus` | Sidebar items open a "Pro feature" page (UI lock) |
| `locked_models` | Those VFD models need Pro (UI lock) |
| `lock_search`, `lock_custom_category`, `lock_requests` | Server answers HTTP 402 `PREMIUM_REQUIRED` |
| `max_comments`, `max_highlights`, `max_bookmarks`, `max_upload_mb` | Server answers 402 when the count/size is exceeded |
| `lock_text_mapping`, `lock_highlight_matched` | Selectable text layer / yellow quote mark on manual page images are off |
| `trial_days` | Free full access given at registration (default 2, 0 = none) |
| `payment` | bKash number/type, bank accounts, receipt e-mail, instructions shown in the payment form |

The client turns every 402 with `code: 'PREMIUM_REQUIRED'` into the pricing dialog (`setPremiumHandler`).

## 3. Free full-access period

* Column `users.full_access_until` (migration v15).
* Set at **self-registration** to `now + trial_days` (`newUserTrialEnd()`); users created by a Super Admin and existing users get none.
* The Super Admin edits it per user: Users & Monitoring → user → "Free full access until" (`PATCH /api/admin/users/:id { fullAccessUntil }`, `null` removes it).
* While running, a notice "FREE FULL ACCESS · … left" shows above the user name in the sidebar.
* After it ends the user is Free unless a subscription is active.

## 4. Pricing plans (Super Admin → Pricing)

Table `pricing_plans` (migration v16):

`id, name, monthly_original, monthly_price, yearly_original, yearly_price, currency, active, created_by, created_at, disabled_by, disabled_at, disabled_reason`

Rules (enforced on the server, not only in the UI):

* A plan always has **both** Monthly and Yearly, each with **original** and **discounted** price (`*_price` = what the user pays; must be ≤ original).
* **No edit.** There is no update endpoint. A created plan never changes — not even for a Super Admin.
* **Disable only**, behind a confirmation: `POST /api/premium-admin/pricing/:id/disable { confirm: true }` (without `confirm: true` → 400).
  A disabled plan cannot be enabled again and cannot be deleted. The last active plan cannot be disabled (users must have somewhere to move).
* Several Super Admins may create plans (`created_by` is recorded).
* Migration v16 seeds plan #1 "Pro" (99 / 450) from the pre-existing fixed prices and links all older subscriptions to it.

Endpoints: `GET/POST /api/premium-admin/pricing`, `POST /api/premium-admin/pricing/:id/disable`; users read active plans from `/api/premium/status → pricingPlans`.

## 5. Subscription data model

Table `subscriptions` (v11 + v16). Important columns:

| Column | Meaning |
|---|---|
| `plan` | billing type: `monthly` \| `yearly` |
| `pricing_plan_id` | pricing plan the user chose (stays with the subscription) |
| `amount`, `currency` | **payable amount** = the plan's discounted price at submission time (snapshot) |
| `status` | `draft` (pending verification) \| `active` \| `cancelled` |
| `outcome` | why it is cancelled: `rejected` \| `withdrawn` \| `cancelled_by_user` \| `cancelled_by_admin` |
| `subscribed_at` | exact moment the payment was approved (subscription created) |
| `starts_at` / `ends_at` | effective period (see §6) |
| `deleted_at`, `cancelled_at` | **soft delete** on cancellation |
| `migrate_to` | scheduled billing-type change, applied from the next billing cycle |
| `receipt_upload_id`, `user_note`, `admin_note`, `decided_by`, `decided_at` | review data |

Derived **state** shown to people (`subState()`): `pending`, `active`, `scheduled` (starts in the future), `expired`, `rejected`, `cancelled`.
`status` values were not extended (SQLite cannot change a CHECK without rebuilding the table); `outcome` and the derived state carry the detail.

Payment ledger `payments` (v12 + v16 `pricing_plan_id`, `plan_type`): one row per payment received, linked to `subscription_id`.

## 6. Time rules

* **Start:** `starts_at = ceilHour(now)` at the moment of approval — the next full hour; a time already on the hour stays
  (`10:35:45 → 11:00:00`, `11:00:00 → 11:00:00`). Uses the server's local time zone.
  If a paid period is still running, the new period instead starts exactly when it ends (**next billing cycle**).
* **End:** `ends_at = addPeriod(starts_at, billing)` — one calendar month (31 Jan + 1 month = 28/29 Feb) or one calendar year.
* **Expiry:** automatic; after `ends_at` the user is Free (see §1). No cron job.
* Access is granted from approval; the rounding only decides the recorded period start (≤ 1 hour ahead).

## 7. Payment process (end to end)

1. **User** opens *Get Pro* (or Settings → **Submit Payment**) → chooses pricing plan (if several), Monthly/Yearly.
   If the profile is incomplete (full name, e-mail, phone) the profile step comes first.
2. The form shows **Pricing plan ID, name, pricing type, payment amount, start time** and a warning: transferring **less than the payable amount may be rejected**.
   The user pays by bKash/bank (details from Premium Settings) and uploads the **receipt image** (JPEG/PNG/WebP ≤ 10 MB), optional note.
3. `POST /api/premium/subscribe` (multipart: `plan`, `pricing_plan_id`, `receipt`, `note`) creates a `draft` row — **Pending verification**.
   Validations: plan active; profile complete; no other pending request; if a billing change is scheduled the type must match; next period not already paid.
   The user can withdraw a pending request (`DELETE /api/premium/subscriptions/:id`) and always sees all submissions with status (`GET /api/premium/mine`).
4. **Super Admin** (Subscriptions) opens the receipt and decides (`PATCH /api/premium-admin/subscriptions/:id`):
   * `activate` (**Approve payment**) → in one transaction: status `active`, `subscribed_at`, `starts_at`, `ends_at` set; the **payment record is created
     automatically** with the *payable amount*, plan id, plan type and link to the subscription (no manual amount entry);
     a scheduled `migrate_to` on the previous period is cleared because the next period now carries it.
   * `reject` (**Reject payment**, e.g. insufficient amount, with note shown to the user) → `cancelled`, `outcome='rejected'`.
   * `cancel` → ends an approved subscription now (soft delete).
5. The user becomes Pro (status endpoint changes immediately).

## 8. Migration (Monthly ↔ Yearly)

* `POST /api/premium/migrate { to: 'monthly'|'yearly'|null }` only **schedules** (`migrate_to` on the running subscription). The running subscription is **not changed**.
* Effective date = running `ends_at` (next billing cycle). The confirm window shows it highlighted; Settings → Submit Payment shows the scheduled change.
* The next payment must be for the scheduled type (`/subscribe` enforces it). When it is approved, the new period starts at `ends_at` and the schedule is cleared.
* `to: null` withdraws the schedule. Not possible once the next period is already paid.

## 9. Cancellation

* `POST /api/premium/cancel` — **immediate**: all of the user's running/scheduled subscriptions get `status='cancelled'`, `outcome='cancelled_by_user'`,
  `cancelled_at` and `deleted_at` (**soft delete**, rows are kept for audit; payment records stay and remain linked).
* The user is Free at once. A later subscription is a brand-new subscription (new payment, new start rounding).

## 10. Pricing plan disabled → forced migration

* Existing paid periods stay valid. `status.needsPlanMigration = true` while the running subscription's plan is disabled; a banner explains it.
* `/subscribe` only accepts **active** plans, so the next payment must be for one of them.

## 11. Super Admin rules (users)

* Several Super Admin accounts may exist and create pricing plans, but **only one is active at a time**.
* Activating a Super Admin (`PATCH /api/admin/users/:id { status: 'enabled' }`) **deactivates every other Super Admin** and ends their sessions at once
  (activity log entries are written). The UI asks for confirmation first and the Users list refreshes.
* A new Super Admin (created, or an account promoted to Super Admin) starts **inactive** when another one is active, until it is activated.
* The "last active Super Admin cannot be disabled" guard stays.

## 12. Other existing features that touch money/access

* **Payments ledger** (Super Admin → Payments): CRUD + search/filter (date range, method, status), totals; auto rows come from approvals (§7).
* **Subscriptions page**: review cards with receipt thumbnails, filters.
* **Superadmin Panel** `/superadmin/*`: Pricing, Subscriptions, Payments, Premium Settings, Verification, Content, Users, Requests, Logs, Settings. Notes/bookmarks are disabled there.
* **Login as** (impersonation) for support; recorded in the activity log.
* **Receipts** are served only to their owner and the Super Admin (`GET /api/premium/receipt/:uploadId`).
* **Privacy Policy & Service Terms**: `/privacy` (public). Linked from Login, Register, the payment form and Settings → Submit Payment.

## 13. Audit

Every create/approve/reject/cancel/disable writes `audit()` (entity, previous/next, actor) or `logActivity()` (user events:
`subscription_request`, `subscription_withdraw`, `subscription_migrate_schedule`, `subscription_cancel`, admin account changes).
Payment ↔ subscription ↔ pricing plan stay linked by ids for reporting.

## 14. Known limits

* Time rounding uses the server's local time zone.
* Receipts are checked by a person; there is no payment-gateway integration.
* `status` has no `expired`/`rejected` values; use the derived state / `outcome`.

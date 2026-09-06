---
name: legal-domain-logic
description: Skill for implementing domain-specific legal workflows, including Case Matter lifecycles, limitation period date calculations, hearing schedules, and fee structures.
---

# Legal Domain Data Models & Workflows

## Purpose
Enforce accurate legal domain semantics, field structures, and lifecycle states to prevent business-logic corruption in case matters and court schedules.

## Domain Model Specifications

### 1. Case Matter Lifecycle
A matter MUST transition strictly through these states:
`Intake` -> `Active` -> `Pending Hearing` -> `Reserved for Judgment` -> `Disposed/Closed` -> `Archived`

- **Rule**: Do not allow shifting a matter to `Disposed` without recording a `disposal_date` and `final_order_summary`.

### 2. Dates & Limitation Calculation
- Standardize all legal dates into strict UTC ISO strings in the DB, but convert to local court timezone for UI display.
- Include auto-calculation helpers for court limitation periods (e.g., `calculateLimitationDate(cause_of_action_date, statutory_days)`).
- Warn the user if a scheduled hearing date falls on a weekend or public court holiday.

### 3. Financial & Fee Tracking
- Money amounts must be stored as integers in minor currency units (e.g., paise/cents) to eliminate floating-point rounding errors.
- Support retainer billing, per-hearing fees, and fixed-case fees.

## UI Data Representation
- Format matter numbers consistently (e.g., `WP(C)/1024/2026`).
- Display Next Hearing Date prominently on every matter card using plain relative human phrasing (e.g., "Tomorrow at 10:30 AM", "In 3 days").
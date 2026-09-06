---
name: offline-pwa-sync
description: Skill for configuring PWA Service Workers, IndexedDB local persistence, offline queueing, and background sync when working on offline capability for the legal app.
---

# Offline-First PWA & Data Synchronization

## Purpose
Ensure lawyers can access, draft, and modify matter notes, schedules, and client records inside courtroom basements or dead-zones with zero network latency, automatically resolving conflicts when reconnected.

## Architectural Directives
- **Storage Strategy**: Use IndexedDB (via Dexie.js or idb) as the primary source of truth for read/write operations on client devices. Never block UI rendering on network calls.
- **Service Worker Lifecycle**:
  - Implement a `stale-while-revalidate` caching strategy for static assets and shell UI.
  - Implement a `network-first` with fallback to IndexedDB for legal data fetches.
- **Write Operations & Background Sync**:
  - Save all mutations (new notes, updated court dates, time tracking entries) into an `offline_mutation_queue` table in IndexedDB with an ISO-8601 `client_timestamp` and a unique UUID `idempotency_key`.
  - Use `Background Sync API` (`sync` event) to flush mutations sequentially when connectivity recovers.

## Conflict Resolution Rules
- **Field-Level Last-Write-Wins (LWW)**: Compare server `updated_at` against client `updated_at`. If a conflict occurs on text fields (e.g., case notes), do not overwrite—append the offline change as an uncommitted draft and flag it for user review.
- **Sync Status UI**: Every sync action must update a global sync indicator token: `synced`, `syncing`, `offline_pending`, or `sync_error`.

## Success Metrics
- Full offline load time under 300ms.
- Zero data loss during unexpected connection dropouts mid-form entry.
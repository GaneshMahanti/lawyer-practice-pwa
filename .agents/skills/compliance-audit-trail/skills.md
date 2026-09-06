---
name: compliance-audit-trail
description: Skill for enforcing legal compliance, client confidentiality, append-only activity logging, and privilege data boundary checks.
---

# Compliance, Privacy & Immutable Audit Trail

## Purpose
Ensure the application maintains attorney-client privilege boundaries, immutable logging of document access/modifications, and strict data isolation.

## Security & Compliance Directives

### 1. Immutable Audit Logging
- Every `CREATE`, `UPDATE`, `DELETE`, or `EXPORT` action on client or case data must write an append-only entry to the `audit_logs` table.
- Log schema requirement:
  ```json
  {
    "log_id": "UUID",
    "user_id": "UUID",
    "action": "MATTER_UPDATE",
    "resource_type": "case_file",
    "resource_id": "UUID",
    "timestamp": "ISO-8601 UTC",
    "changes": { "before": {}, "after": {} },
    "ip_hash": "SHA-256"
  }
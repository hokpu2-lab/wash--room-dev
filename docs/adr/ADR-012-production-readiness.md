# ADR-012 Production readiness and free-plan limits

## Decision

The production gate is the locked CI sequence (lint, typecheck, database tests,
build, public/configured Playwright), followed by a read-only `/status` smoke
check and a bounded concurrent status load check. Database migrations are first
rehearsed on a disposable Supabase project. No production command deletes data.

The system treats Vercel and Supabase free plans as supported deployment targets,
not as an availability promise: backups, retention, Fair Use, and provider rate
limits remain operational responsibilities. External notification credentials
are environment-only. Capacity alerts are durable threshold crossings and do not
automatically stop work or delete records.

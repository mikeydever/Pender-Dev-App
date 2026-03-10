# AGENTS.md

## Project Context
- Stack: vanilla frontend (`index.html`, `app.js`) + Supabase Edge Functions (`supabase/functions/*`).
- Purpose: ingest receipts, extract expense fields, store/report project expenses.

## Code Review Priorities
1. Security first.
- Do not commit secrets, API keys, service-role tokens, or passwords in frontend code or tracked config files.
- Treat anything in client-side JavaScript as public.
2. Data integrity and money safety.
- Any logic that parses `amount`, `date`, or `provider` must preserve existing validation behavior.
- Reject changes that can silently create malformed expenses or duplicate writes.
3. Edge Function contract safety.
- Keep request/response payloads backward compatible unless the PR clearly migrates both caller and callee.
- Preserve CORS behavior for browser callers.
4. Failure handling.
- Network/API/storage failures must return explicit errors and avoid partial-success states.
5. Regression risk.
- Changes to category inference, CSV export, or upload/extraction flows need targeted validation notes in the PR.

## Minimum Checks For Every PR
Run these before merge (locally or in CI):

```bash
node --check app.js check.js check2.js check3.js
deno check supabase/functions/upload-receipt/index.ts
deno check supabase/functions/extract-receipt-expense/index.ts
deno check supabase/functions/email-expenses-update/index.ts
bash -n scripts/deploy_edge_functions.sh
```

## Review Output Expectations
- Report findings ordered by severity (`P0`/`P1`/`P2`/`P3`).
- Include file + line references for each finding.
- If no findings, explicitly state that and list any test coverage gaps.

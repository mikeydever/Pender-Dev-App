## Summary
- What changed and why?

## Risk Assessment
- User-facing impact:
- Data integrity impact:
- Security/privacy impact:

## Validation
- [ ] `node --check app.js check.js check2.js check3.js`
- [ ] `deno check supabase/functions/upload-receipt/index.ts`
- [ ] `deno check supabase/functions/extract-receipt-expense/index.ts`
- [ ] `deno check supabase/functions/email-expenses-update/index.ts`
- [ ] `bash -n scripts/deploy_edge_functions.sh`
- [ ] Manual smoke test completed for changed flow

## Reviewer Notes
- Areas that need extra scrutiny:
- Follow-up tasks (if any):

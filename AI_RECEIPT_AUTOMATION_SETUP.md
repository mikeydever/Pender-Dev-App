# AI Receipt Automation Setup

This app now supports:

1. OCR-first extraction when a receipt image/PDF is uploaded.
2. AI fallback if OCR is weak.
3. Emailing an updated expense spreadsheet (CSV attachment) after insert/delete updates.

## What was added

- Frontend OCR + auto-add pipeline in `app.js`
- Edge function fallback:
  - `supabase/functions/extract-receipt-expense/index.ts`
- Edge function upload fallback:
  - `supabase/functions/upload-receipt/index.ts`
- Edge function email sender:
  - `supabase/functions/email-expenses-update/index.ts`

## Prerequisites

- Supabase project (already used by app)
- OpenAI API key (for fallback extraction)
- Resend account + API key (for email sending)
- A verified sender email in Resend (used as `EXPENSE_EMAIL_FROM`)
- Supabase CLI installed locally

## 1) Add your keys locally

Edit this file:

`supabase/.env.functions`

Required values:

- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `EXPENSE_EMAIL_FROM` (must be a verified Resend sender)

Optional:

- `OPENAI_RECEIPT_MODEL` (default `gpt-4.1-mini`)
- `SUPABASE_PROJECT_REF` (default `ibjocekpexrmpkyuhgtv`)

## 2) Deploy with one command

Run in project root:

```bash
supabase login
./scripts/deploy_edge_functions.sh
```

This script will:

1. Link the Supabase project.
2. Set all required secrets.
3. Deploy `upload-receipt`.
4. Deploy `extract-receipt-expense`.
5. Deploy `email-expenses-update`.

## 4) Test flow

1. Open app and log in.
2. Go to `All Expenses` -> `+ Add Expense`.
3. Upload a receipt image or PDF.
4. App runs OCR first. If confidence is low, it calls `extract-receipt-expense`.
5. If enough fields are detected, expense is auto-saved.
6. After save/delete, app calls `email-expenses-update`, which sends `michaelwindeyermarketing@gmail.com` a CSV attachment.

## Notes

- OCR runs in-browser (Tesseract + PDF.js).
- AI fallback requires working Supabase function + OpenAI secret.
- Email uses CSV attachment because it is spreadsheet-compatible and simple to generate server-side.
- If email function fails, expense save still succeeds; failure is logged in console.
- `supabase/.env.functions` is ignored by git to avoid leaking secrets.

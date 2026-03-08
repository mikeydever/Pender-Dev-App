import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExpenseRow = {
  id: string;
  date: string;
  amount: number;
  provider: string;
  description: string;
  category: string;
  notes: string | null;
  year: number;
  receipt_url: string | null;
  receipt_name: string | null;
  created_at: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function toCsv(rows: ExpenseRow[]) {
  const headers = [
    "id",
    "date",
    "amount",
    "provider",
    "description",
    "category",
    "notes",
    "year",
    "receipt_url",
    "receipt_name",
    "created_at",
  ];

  const escape = (value: unknown) => {
    const text = String(value ?? "");
    if (/[,"\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };

  const body = rows.map((row) =>
    [
      row.id,
      row.date,
      row.amount,
      row.provider,
      row.description,
      row.category,
      row.notes,
      row.year,
      row.receipt_url,
      row.receipt_name,
      row.created_at,
    ].map(escape).join(",")
  );

  return [headers.join(","), ...body].join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const EMAIL_FROM = Deno.env.get("EXPENSE_EMAIL_FROM");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return jsonResponse({ error: "Missing RESEND_API_KEY or EXPENSE_EMAIL_FROM" }, 500);
  }

  let payload: { recipient?: string; action?: string };
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const recipient = payload.recipient ?? "michaelwindeyer@gmail.com";
  const action = payload.action ?? "update";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });

  if (error) return jsonResponse({ error: "Failed to read expenses", details: error.message }, 500);

  const rows = (data ?? []) as ExpenseRow[];
  const csv = toCsv(rows);
  const csvBase64 = encodeBase64(new TextEncoder().encode(csv));

  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [recipient],
      subject: `Pender expenses updated (${action}) - ${today}`,
      html: `<p>The expense ledger was updated (${action}).</p><p>Rows: <strong>${rows.length}</strong><br/>Total spend: <strong>$${total.toFixed(2)}</strong></p>`,
      attachments: [
        {
          filename: `pender-expenses-${today}.csv`,
          content: csvBase64,
        },
      ],
    }),
  });

  if (!resendRes.ok) {
    const failure = await resendRes.text();
    return jsonResponse({ error: "Resend request failed", details: failure }, 502);
  }

  const resendBody = await resendRes.json();
  return jsonResponse({ ok: true, rows: rows.length, emailId: resendBody.id ?? null });
});

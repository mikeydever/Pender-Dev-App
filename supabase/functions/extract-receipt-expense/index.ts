import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExtractRequest = {
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
  ocrText?: string;
};

type ExtractResponse = {
  provider: string;
  amount: number | null;
  date: string | null;
  description: string;
  category: string;
  notes: string;
  confidence: number;
};

const RECEIPT_SCHEMA = {
  name: "receipt_expense_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      provider: { type: "string" },
      amount: { type: ["number", "null"] },
      date: { type: ["string", "null"] },
      description: { type: "string" },
      category: {
        type: "string",
        enum: [
          "Construction / Labour",
          "Materials & Supplies",
          "Permits & Legal",
          "Professional Services",
          "Landscaping",
          "Utilities & Site Setup",
          "Transportation",
          "Accommodation",
          "Taxes & Fees",
          "Other",
        ],
      },
      notes: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["provider", "amount", "date", "description", "category", "notes", "confidence"],
  },
  strict: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeResult(raw: Record<string, unknown> | null, fallbackDescription: string): ExtractResponse {
  const provider = String(raw?.provider ?? "").trim();
  const amount = typeof raw?.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : null;
  const date = typeof raw?.date === "string" ? raw.date : null;
  const description = String(raw?.description ?? fallbackDescription).trim() || fallbackDescription;
  const category = String(raw?.category ?? "Other");
  const notes = String(raw?.notes ?? "Extracted via AI fallback.");
  const confidence = typeof raw?.confidence === "number" ? raw.confidence : 0.5;

  return { provider, amount, date, description, category, notes, confidence };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return jsonResponse({ error: "Missing OPENAI_API_KEY" }, 500);

  let payload: ExtractRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const fileName = payload.fileName ?? "receipt";
  const mimeType = payload.mimeType ?? "application/octet-stream";
  const ocrText = (payload.ocrText ?? "").slice(0, 12000);
  const fallbackDescription = `Receipt expense (${fileName})`;

  const userContent: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: [
        "Extract expense fields from this receipt data.",
        "Prefer receipt total (not tax sub-lines), vendor name, purchase date, short description, and best category.",
        "Return null amount/date only if truly absent.",
        `File name: ${fileName}`,
        `OCR text:\n${ocrText || "(none)"}`,
      ].join("\n\n"),
    },
  ];

  if ((mimeType.startsWith("image/") || fileName.match(/\.(png|jpe?g|webp|heic)$/i)) && payload.fileBase64) {
    userContent.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${payload.fileBase64}`,
    });
  }

  const openAiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_RECEIPT_MODEL") ?? "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You extract accounting fields from receipts. Output only valid JSON matching the schema.",
            },
          ],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...RECEIPT_SCHEMA,
        },
      },
    }),
  });

  if (!openAiRes.ok) {
    const failure = await openAiRes.text();
    return jsonResponse({ error: "OpenAI request failed", details: failure }, 502);
  }

  const openAiBody = await openAiRes.json();
  const outputText: string =
    openAiBody.output_text ??
    openAiBody.output?.[0]?.content?.find((c: Record<string, unknown>) => c.type === "output_text")?.text ??
    "";

  const normalized = normalizeResult(safeJsonParse(outputText), fallbackDescription);
  return jsonResponse(normalized);
});

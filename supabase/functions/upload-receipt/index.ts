import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function decodeBase64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim() || "receipt-upload";
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.slice(-120);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  let payload: { fileName?: string; mimeType?: string; fileBase64?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const fileName = sanitizeFileName(payload.fileName ?? "");
  const mimeType = payload.mimeType ?? "application/octet-stream";
  const fileBase64 = payload.fileBase64 ?? "";
  if (!fileBase64) return jsonResponse({ error: "Missing fileBase64" }, 400);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(fileBase64);
  } catch {
    return jsonResponse({ error: "Invalid base64 payload" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const bucketName = "receipts";

  const { data: bucketData } = await supabase.storage.getBucket(bucketName);
  if (!bucketData) {
    const { error: createBucketError } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: "50MB",
    });
    if (createBucketError && !/already exists/i.test(createBucketError.message || "")) {
      return jsonResponse({ error: "Could not create bucket", details: createBucketError.message }, 500);
    }
  }

  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 9);
  const path = `${datePrefix}/${Date.now()}_${random}_${fileName}`;

  const { error: uploadError } = await supabase.storage.from(bucketName).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) {
    return jsonResponse({ error: "Upload failed", details: uploadError.message }, 500);
  }

  const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(path);
  return jsonResponse({
    ok: true,
    url: publicData.publicUrl,
    name: fileName,
    path,
    bucket: bucketName,
  });
});


// ── CONFIG ──────────────────────────────────────────────────────
const PASSWORD = 'pender2024';
const PROPERTY_COST = 500000;
const CONFIG_KEY = 'pender_supabase_config';
const SEED_DATA_PATH = 'expenses_seed.json';
const LOCAL_EXPENSES_KEY = 'pender_local_expenses';
const OCR_MIN_TEXT_LENGTH = 30;
const AUTO_ADD_FROM_RECEIPT = true;
const AI_RECEIPT_FUNCTION = 'extract-receipt-expense';
const EMAIL_UPDATE_FUNCTION = 'email-expenses-update';
const UPDATE_EMAIL_RECIPIENT = 'michaelwindeyer@gmail.com';
const MAX_AUTO_PARSED_AMOUNT = 250000;
const MIN_REASONABLE_YEAR = 2010;

const CAT_COLORS = {
  'Construction / Labour': '#4a7c59', 'Materials & Supplies': '#8aab7e',
  'Permits & Legal': '#7a5c3a', 'Professional Services': '#a07820',
  'Landscaping': '#2d4a3e', 'Utilities & Site Setup': '#a8c8c4',
  'Transportation': '#c4a882', 'Accommodation': '#b8860b',
  'Taxes & Fees': '#b85a2a', 'Other': '#888',
};
const PCOLS = ['#2d4a3e', '#4a7c59', '#7a5c3a', '#a07820', '#b85a2a', '#8aab7e', '#a8c8c4', '#c4a882', '#666', '#999'];

// ── STATE ───────────────────────────────────────────────────────
let supabaseClient = null;
let expenses = [];
let charts = {};
let selectedFile = null;
let isLocalMode = false;
let isReceiptProcessing = false;
let lastAutoSaveSignature = '';
let lastAutoSaveAt = 0;

// ── INIT ────────────────────────────────────────────────────────
async function startup() {
  try {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const config = getConfig();
    if (!config) {
      const seeded = await loadSeedExpenses();
      if (seeded.length) {
        expenses = withResolvedCategories(mergeWithLocal(seeded));
        isLocalMode = true;
        hide('loading-screen');
        show('login-screen');
        return;
      }
      hide('loading-screen');
      show('setup-screen');
      return;
    }
    if (!window.supabase) throw new Error("Supabase is missing");
    initSupabase(config.url, config.key);
    hide('loading-screen');
    show('login-screen');
  } catch (e) {
    console.error(e);
    document.querySelector('.loading-text').innerHTML = `<span style="color:red">Error:<br>${e.message}</span>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startup);
} else {
  startup();
}

function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch (e) { return null; }
}

function initSupabase(url, key) {
  supabaseClient = window.supabase.createClient(url, key);
}

function inferCategory(expense) {
  const current = String(expense.category || '').trim();
  if (current && current !== 'Other') return current;

  const text = `${expense.provider || ''} ${expense.description || ''}`.toLowerCase();

  if (/(accommodat|accomodations?|hotel|airbnb|lodging)/.test(text)) return 'Accommodation';
  if (/(ferr(y|ies)|courier|shipping|transport|gas|fuel|freight)/.test(text)) return 'Transportation';
  if (/(land tax|tax|gst|pst|levy|fee)/.test(text)) return 'Taxes & Fees';
  if (/(court|permit|title|legal|notary|survey authority|land title)/.test(text)) return 'Permits & Legal';
  if (/(design|architect|engineer|testing|inspection|consult)/.test(text)) return 'Professional Services';
  if (/(hydro|utility|water|septic|site setup)/.test(text)) return 'Utilities & Site Setup';
  if (/(holdings|milling|construction|labour|worker|contractor|excavat|framing|roof|electrical|plumbing|titan machinery)/.test(text)) return 'Construction / Labour';
  if (/(interior|lumber|hardware|material|suppl(y|ies)|home show|camera)/.test(text)) return 'Materials & Supplies';
  if (/(landscap|garden|soil|mulch|tree)/.test(text)) return 'Landscaping';

  return 'Other';
}

function withResolvedCategories(rows) {
  return rows.map(row => ({ ...row, category: inferCategory(row) }));
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isLikelyBadProvider(provider) {
  const value = normalizeText(provider).toLowerCase();
  if (!value) return true;
  if (/^x\s*\d+$/i.test(value)) return true;
  if (/^[\d\W_]+$/.test(value)) return true;
  if (value.length < 4) return true;
  const letterCount = (value.match(/[a-z]/g) || []).length;
  if (letterCount < 3) return true;
  const digitCount = (value.match(/\d/g) || []).length;
  if (digitCount > 0 && digitCount >= letterCount) return true;
  return false;
}

function isPlausibleExpenseAmount(amount) {
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_AUTO_PARSED_AMOUNT;
}

function isPlausibleExpenseDate(isoDate) {
  if (!isoDate) return false;
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const year = parsed.getFullYear();
  if (year < MIN_REASONABLE_YEAR) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return parsed <= tomorrow;
}

function toIsoDate(value) {
  if (!value) return null;
  const input = String(value).trim();
  let match = input.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  match = input.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (match) {
    const m = Number(match[1]);
    const d = Number(match[2]);
    const yRaw = Number(match[3]);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(value) {
  let clean = String(value || '').trim();
  if (!clean) return null;
  clean = clean.replace(/\s+/g, '').replace(/\$/g, '');

  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/,/g, '');
  } else if (clean.includes(',') && !clean.includes('.')) {
    if ((clean.match(/,/g) || []).length === 1 && /,\d{2}$/.test(clean)) {
      clean = clean.replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  }

  clean = clean.replace(/[^\d.-]/g, '');
  if (!clean || (clean.match(/\./g) || []).length > 1) return null;

  const amount = Number.parseFloat(clean);
  return Number.isFinite(amount) ? amount : null;
}

function parseReceiptFromText(text, fileName = '') {
  const raw = String(text || '');
  const normalized = normalizeText(raw);
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const amountRegex = /\$?\s*\d[\d,]*\.\d{2}/g;
  const candidates = [];
  for (const line of lines) {
    const matches = line.match(amountRegex) || [];
    for (const match of matches) {
      const amount = parseAmount(match);
      if (!isPlausibleExpenseAmount(amount)) continue;
      let score = 0;
      if (/\b(amount due|balance due|grand total|total due)\b/i.test(line)) score += 5;
      if (/\btotal\b/i.test(line) && !/\bsub\s*total\b/i.test(line)) score += 3;
      if (/\bsub\s*total\b/i.test(line)) score -= 1;
      if (/\b(gst|pst|hst|tax|change)\b/i.test(line)) score -= 2;
      if (amount >= 10) score += 0.5;
      candidates.push({ amount, score, line });
    }
  }
  candidates.sort((a, b) => (b.score - a.score) || (b.amount - a.amount));
  const amount = candidates.length ? candidates[0].amount : null;
  const amountFromTotalLine = candidates.length && /\btotal\b/i.test(candidates[0].line) && !/\bsub\s*total\b/i.test(candidates[0].line);
  const subtotalCandidate = candidates.find(c => /\bsub\s*total\b/i.test(c.line));
  const taxCandidates = candidates.filter(c => /\b(gst|pst|hst|tax)\b/i.test(c.line) && !/\b(total|sub\s*total)\b/i.test(c.line));
  const taxSum = taxCandidates.reduce((sum, c) => sum + c.amount, 0);
  let amountLooksSuspicious = false;
  if (amount && candidates.length >= 3) {
    const sortedAmounts = candidates.map(c => c.amount).sort((a, b) => a - b);
    const median = sortedAmounts[Math.floor(sortedAmounts.length / 2)] || 0;
    if (median > 0 && amount / median >= 4) amountLooksSuspicious = true;
  }
  if (amount && subtotalCandidate && taxSum > 0) {
    const expected = subtotalCandidate.amount + taxSum;
    if (Math.abs(amount - expected) > Math.max(2, expected * 0.25)) amountLooksSuspicious = true;
  }
  const dateCandidates = [
    ...raw.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g) || [],
    ...raw.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g) || [],
    ...raw.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi) || [],
  ];
  let isoDate = null;
  for (const candidate of dateCandidates) {
    isoDate = toIsoDate(candidate);
    if (isoDate) break;
  }
  if (!isPlausibleExpenseDate(isoDate)) isoDate = null;

  const providerBlacklist = /receipt|invoice|total|subtotal|tax|date|visa|mastercard|debit|credit|hst|gst|pst|thank|change|auth|transaction|approval|item|regular sale/i;
  let provider = '';
  let providerScore = -Infinity;
  for (const line of lines.slice(0, 24)) {
    if (line.length < 3 || line.length > 70) continue;
    if (providerBlacklist.test(line)) continue;
    if (!/[a-zA-Z]/.test(line)) continue;
    let score = 0;
    const letterCount = (line.match(/[a-zA-Z]/g) || []).length;
    const digitCount = (line.match(/\d/g) || []).length;
    if (letterCount >= 6) score += 2;
    if (digitCount === 0) score += 2;
    if (/^[A-Z&.'\-\s]+$/.test(line)) score += 1;
    if (/\$|\b\d{2,}\b/.test(line)) score -= 2;
    if (/^x\s*\d+$/i.test(line)) score -= 6;
    if (score > providerScore) {
      provider = line;
      providerScore = score;
    }
  }
  if (isLikelyBadProvider(provider)) provider = '';

  let description = `${provider || 'Receipt'} expense`;
  if (fileName) description = `${description} (${fileName})`;

  if (!isoDate) isoDate = new Date().toISOString().slice(0, 10);

  const parsed = {
    provider,
    amount,
    date: isoDate,
    description,
    category: inferCategory({ provider, description, category: 'Other' }),
    notes: `Auto-extracted from receipt OCR.${normalized ? ` OCR text: ${normalized.slice(0, 400)}` : ''}`,
  };

  let confidenceScore = [provider, amount, isoDate].filter(Boolean).length / 3;
  if (isLikelyBadProvider(provider)) confidenceScore -= 0.5;
  if (!isPlausibleExpenseAmount(amount)) confidenceScore -= 0.5;
  if (!isPlausibleExpenseDate(isoDate)) confidenceScore -= 0.25;
  if (!amountFromTotalLine) confidenceScore -= 0.15;
  if (amountLooksSuspicious) confidenceScore -= 0.45;
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));
  return { parsed, confidenceScore };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function runImageOcr(dataUrl) {
  if (!window.Tesseract) return '';
  const result = await window.Tesseract.recognize(dataUrl, 'eng');
  return result?.data?.text || '';
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) return '';
  const bytes = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const maxPages = Math.min(pdf.numPages, 3);
  let text = '';
  for (let i = 1; i <= maxPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += ` ${content.items.map(item => item.str).join(' ')}`;
  }
  return normalizeText(text);
}

async function renderPdfFirstPageToDataUrl(file) {
  if (!window.pdfjsLib) return '';
  const bytes = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function runAgentReceiptFallback(file, ocrText) {
  if (!supabaseClient) return null;
  const dataUrl = await readFileAsDataURL(file);
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const { data, error } = await supabaseClient.functions.invoke(AI_RECEIPT_FUNCTION, {
    body: {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: base64,
      ocrText: normalizeText(ocrText).slice(0, 12000),
    }
  });
  if (error) throw error;
  return data || null;
}

function applyExtractedExpenseFields(extracted, sourceLabel = 'OCR') {
  if (!extracted) return false;
  if (extracted.date) document.getElementById('m-date').value = toIsoDate(extracted.date) || document.getElementById('m-date').value;
  if (extracted.amount) document.getElementById('m-amount').value = Number(extracted.amount).toFixed(2);
  if (extracted.provider) document.getElementById('m-provider').value = extracted.provider;
  if (extracted.description) document.getElementById('m-desc').value = extracted.description;
  const category = inferCategory({
    provider: extracted.provider || '',
    description: extracted.description || '',
    category: extracted.category || 'Other',
  });
  document.getElementById('m-cat').value = category;
  if (extracted.notes) document.getElementById('m-notes').value = extracted.notes;
  toast(`${sourceLabel} captured receipt fields`);
  return true;
}

function hasMinimumFieldsForAutoSave() {
  const date = document.getElementById('m-date').value;
  const amount = parseFloat(document.getElementById('m-amount').value);
  const provider = document.getElementById('m-provider').value.trim();
  const desc = document.getElementById('m-desc').value.trim();
  return Boolean(date && Number.isFinite(amount) && amount > 0 && provider && desc);
}

function shouldSkipDuplicateAutoSave(file, extracted) {
  const sig = [
    file?.name || '',
    file?.size || 0,
    file?.lastModified || 0,
    extracted?.provider || '',
    extracted?.amount || '',
    extracted?.date || '',
  ].join('|');
  const now = Date.now();
  const isDuplicate = sig === lastAutoSaveSignature && (now - lastAutoSaveAt) < 45000;
  if (!isDuplicate) {
    lastAutoSaveSignature = sig;
    lastAutoSaveAt = now;
  }
  return isDuplicate;
}

function revealSavedExpense(expense) {
  if (!expense) return;
  showTab('expenses');
  const searchInput = document.getElementById('search-input');
  if (searchInput && expense.provider) {
    searchInput.value = expense.provider;
  }
  renderTable();
}

async function processReceiptFile(file) {
  if (isReceiptProcessing) return;
  isReceiptProcessing = true;
  const saveBtn = document.getElementById('save-btn');
  const priorText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Reading receipt…';

  try {
    let ocrText = '';
    if (/pdf/i.test(file.type) || file.name.toLowerCase().endsWith('.pdf')) {
      ocrText = await extractPdfText(file);
      if (ocrText.length < OCR_MIN_TEXT_LENGTH) {
        const pagePreview = await renderPdfFirstPageToDataUrl(file);
        if (pagePreview) ocrText = await runImageOcr(pagePreview);
      }
    } else {
      const dataUrl = await readFileAsDataURL(file);
      ocrText = await runImageOcr(dataUrl);
    }

    const { parsed, confidenceScore } = parseReceiptFromText(ocrText, file.name);
    let extracted = confidenceScore >= 0.67 ? parsed : null;

    if (!extracted && supabaseClient) {
      saveBtn.textContent = 'Running AI extraction…';
      const aiData = await runAgentReceiptFallback(file, ocrText);
      if (aiData) {
        extracted = {
          provider: aiData.provider || '',
          amount: Number(aiData.amount) || null,
          date: aiData.date || new Date().toISOString().slice(0, 10),
          description: aiData.description || `${aiData.provider || 'Receipt'} expense (${file.name})`,
          category: aiData.category || 'Other',
          notes: aiData.notes || 'Auto-extracted via AI fallback.',
        };
      }
    }

    if (extracted) {
      applyExtractedExpenseFields(extracted, confidenceScore >= 0.67 ? 'OCR' : 'AI');
      if (AUTO_ADD_FROM_RECEIPT && hasMinimumFieldsForAutoSave()) {
        if (shouldSkipDuplicateAutoSave(file, extracted)) {
          toast('This receipt was already auto-saved. Skipping duplicate.');
          return;
        }
        toast('Receipt parsed. Auto-saving expense…');
        await saveExpense({ automated: true });
      }
    } else {
      toast('Could not auto-read this receipt. Please fill manually.', true);
    }
  } catch (e) {
    toast(`Receipt read failed: ${e.message}`, true);
  } finally {
    isReceiptProcessing = false;
    if (saveBtn.textContent !== 'Saving…' && saveBtn.textContent !== 'Uploading…') {
      saveBtn.disabled = false;
      saveBtn.textContent = priorText || 'Save Expense';
    }
  }
}

async function notifySpreadsheetEmail(action, expense) {
  if (!supabaseClient || isLocalMode) return;
  try {
    await supabaseClient.functions.invoke(EMAIL_UPDATE_FUNCTION, {
      body: {
        action,
        recipient: UPDATE_EMAIL_RECIPIENT,
        expenseId: expense?.id || null,
      }
    });
  } catch (e) {
    console.warn('Email notification failed:', e);
  }
}

// ── SETUP ───────────────────────────────────────────────────────
async function saveSupabaseConfig() {
  const url = document.getElementById('setup-url').value.trim();
  const key = document.getElementById('setup-key').value.trim();
  if (!url || !key) { alert('Please enter both the URL and API key.'); return; }

  try {
    initSupabase(url, key);
    // Test connection
    const { error } = await supabaseClient.from('expenses').select('id').limit(1);
    if (error) throw error;
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
    hide('setup-screen'); show('login-screen');
    toast('Connected to Supabase! ✓');
  } catch (e) {
    alert('Connection failed: ' + e.message + '\n\nPlease check your URL and API key.');
  }
}

// ── AUTH ────────────────────────────────────────────────────────
function tryLogin() {
  const v = document.getElementById('pw-input').value;
  if (v === PASSWORD) {
    hide('login-screen'); show('app');
    if (supabaseClient) {
      loadData();
    } else {
      setLocalModeSync();
      initApp();
      toast(`Loaded ${expenses.length} imported spreadsheet entries`);
    }
  } else {
    document.getElementById('login-error').textContent = 'Incorrect password.';
    document.getElementById('pw-input').value = '';
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') tryLogin();
});

function logout() {
  hide('app'); show('login-screen');
  document.getElementById('pw-input').value = '';
  document.getElementById('login-error').textContent = '';
}

// ── DATA ────────────────────────────────────────────────────────
async function loadData() {
  setSyncing(true);
  try {
    const { data, error } = await supabaseClient
      .from('expenses')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;
    if (data && data.length) {
      const merged = await maybeBackfillSupabase(data);
      expenses = withResolvedCategories(mergeWithLocal(merged.rows));
      isLocalMode = false;
      setSyncing(false);
      initApp();
      if (merged.inserted > 0) {
        toast(`Added ${merged.inserted} spreadsheet entries to Supabase.`);
      }
      return;
    } else {
      const seeded = await loadSeedExpenses();
      if (seeded.length) {
        // First run on an empty Supabase table: copy spreadsheet seed into Supabase.
        const payload = seeded.map(({ id, ...row }) => ({ ...row, category: inferCategory(row) }));
        const { error: insertError } = await supabaseClient.from('expenses').insert(payload);
        if (!insertError) {
          const { data: seededData, error: seededLoadError } = await supabaseClient
            .from('expenses')
            .select('*')
            .order('date', { ascending: false });
          if (!seededLoadError && seededData && seededData.length) {
            expenses = withResolvedCategories(mergeWithLocal(seededData));
            isLocalMode = false;
            setSyncing(false);
            initApp();
            toast(`Loaded ${seededData.length} entries into Supabase.`);
            return;
          }
        }
      }
      expenses = withResolvedCategories(mergeWithLocal(seeded));
      isLocalMode = seeded.length > 0;
      setSyncing(false);
      if (isLocalMode) setLocalModeSync();
    }
    initApp();
    if (isLocalMode) toast(`Loaded ${expenses.length} imported spreadsheet entries`);
  } catch (e) {
    const seeded = await loadSeedExpenses();
    if (seeded.length) {
      expenses = withResolvedCategories(mergeWithLocal(seeded));
      isLocalMode = true;
      setSyncing(false);
      setLocalModeSync();
      initApp();
      toast(`Supabase unavailable. Loaded ${expenses.length} imported entries.`);
      return;
    }
    setSyncing(false, true);
    toast('Error loading data: ' + e.message, true);
  }
}

function setSyncing(syncing, error = false) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot' + (syncing ? ' syncing' : error ? ' error' : '');
  label.textContent = syncing ? 'Syncing…' : error ? 'Error' : 'Live';
}

function setLocalModeSync() {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot';
  label.textContent = 'Local';
}

async function loadSeedExpenses() {
  try {
    const response = await fetch(SEED_DATA_PATH, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Could not load seed expenses:', e);
    return [];
  }
}

function getLocalExpenses() {
  try {
    const raw = localStorage.getItem(LOCAL_EXPENSES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Could not load local expenses:', e);
    return [];
  }
}

function setLocalExpenses(rows) {
  try {
    localStorage.setItem(LOCAL_EXPENSES_KEY, JSON.stringify(rows));
  } catch (e) {
    console.warn('Could not save local expenses:', e);
  }
}

function addLocalExpense(row) {
  const rows = getLocalExpenses();
  rows.unshift(row);
  setLocalExpenses(rows);
}

function removeLocalExpense(id) {
  const rows = getLocalExpenses().filter(r => r.id !== id);
  setLocalExpenses(rows);
}

function mergeWithLocal(rows) {
  const base = Array.isArray(rows) ? rows : [];
  const locals = getLocalExpenses();
  if (!locals.length) return base;
  const keys = new Set(base.map(expenseMergeKey));
  const extras = locals.filter(r => !keys.has(expenseMergeKey(r)));
  return [...extras, ...base];
}

function expenseMergeKey(row) {
  const rawDate = String(row.date || '').split('T')[0];
  const provider = String(row.provider || '').trim().toLowerCase();
  const description = String(row.description || '').trim().toLowerCase();
  const category = String(row.category || '').trim().toLowerCase();
  const year = String(row.year || '');
  const amountNum = Number(row.amount);
  const amount = Number.isFinite(amountNum) ? amountNum.toFixed(2) : String(row.amount || '');
  return `${rawDate}|${provider}|${description}|${category}|${year}|${amount}`;
}

async function maybeBackfillSupabase(existingRows) {
  const seeded = await loadSeedExpenses();
  if (!seeded.length) return { rows: existingRows, inserted: 0 };

  const existingKeys = new Set(existingRows.map(expenseMergeKey));
  const toInsert = seeded.filter(row => !existingKeys.has(expenseMergeKey(row)));
  if (!toInsert.length) return { rows: existingRows, inserted: 0 };

  const payload = toInsert.map(({ id, ...row }) => ({ ...row, category: inferCategory(row) }));
  const { error: insertError } = await supabaseClient.from('expenses').insert(payload);
  if (insertError) throw insertError;

  const { data, error: reloadError } = await supabaseClient
    .from('expenses')
    .select('*')
    .order('date', { ascending: false });
  if (reloadError) throw reloadError;

  return { rows: data || existingRows, inserted: toInsert.length };
}

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Unknown';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item); return acc;
  }, {});
}

// ── APP INIT ────────────────────────────────────────────────────
function initApp() {
  populateCategoryFilter();
  renderDashboard();
  renderTable();
  renderProviders();
  renderYearly();
}

function populateCategoryFilter() {
  const sel = document.getElementById('filter-cat');
  // Clear existing options except first
  while (sel.options.length > 1) sel.remove(1);
  [...new Set(expenses.map(e => e.category))].sort().forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
  });
}

function showTab(name) {
  ['dashboard', 'expenses', 'providers', 'yearly'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === name ? 'block' : 'none';
  });
  document.querySelectorAll('.navtab').forEach((el, i) => {
    el.classList.toggle('active', ['dashboard', 'expenses', 'providers', 'yearly'][i] === name);
  });
}

// ── DASHBOARD ───────────────────────────────────────────────────
function renderDashboard() {
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  document.getElementById('banner-dev-cost').textContent = fmt(total);
  document.getElementById('banner-total').textContent = fmt(total + PROPERTY_COST);
  document.getElementById('kpi-total').textContent = fmt(total);
  document.getElementById('kpi-count').textContent = expenses.length;
  document.getElementById('kpi-receipts').textContent = expenses.filter(e => e.receipt_url).length;

  const provT = Object.entries(groupBy(expenses, 'provider'))
    .map(([k, v]) => ({ name: k, total: v.reduce((s, e) => s + Number(e.amount), 0) }))
    .sort((a, b) => b.total - a.total);
  if (provT.length) {
    document.getElementById('kpi-top-provider').textContent = provT[0].name;
    document.getElementById('kpi-top-provider-amount').textContent = fmt(provT[0].total) + ' total';
  }

  const catT = Object.entries(groupBy(expenses, 'category'))
    .map(([k, v]) => ({ name: k, total: v.reduce((s, e) => s + Number(e.amount), 0) }))
    .sort((a, b) => b.total - a.total);

  drawBar('chart-provider',
    provT.slice(0, 8).map(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name),
    provT.slice(0, 8).map(d => d.total),
    provT.slice(0, 8).map((_, i) => PCOLS[i % PCOLS.length]));
  drawDoughnut('chart-category', catT.map(d => d.name), catT.map(d => d.total), catT.map(d => CAT_COLORS[d.name] || '#888'));
  drawLine();
}

function drawBar(id, labels, data, colors) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
    type: 'bar', data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } },
        y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } }
      }
    }
  });
}

function drawDoughnut(id, labels, data, colors) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id).getContext('2d'), {
    type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fdfaf4', hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { family: 'Nunito', size: 11 }, color: '#2a2318', boxWidth: 14, padding: 10 } },
        tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) } }
      }
    }
  });
}

function drawLine() {
  if (charts['monthly']) charts['monthly'].destroy();
  const byM = {};
  [...expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
    const k = e.date.slice(0, 7); byM[k] = (byM[k] || 0) + Number(e.amount);
  });
  const keys = Object.keys(byM).sort();
  const labels = keys.map(k => { const [y, m] = k.split('-'); return new Date(y, m - 1).toLocaleString('en-CA', { month: 'short', year: '2-digit' }); });
  const ctx = document.getElementById('chart-monthly').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, 'rgba(74,124,89,.3)'); grad.addColorStop(1, 'rgba(74,124,89,.02)');
  charts['monthly'] = new Chart(ctx, {
    type: 'line', data: { labels, datasets: [{ data: keys.map(k => byM[k]), borderColor: '#4a7c59', backgroundColor: grad, fill: true, tension: .4, pointBackgroundColor: '#2d4a3e', pointRadius: 4, pointHoverRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } },
        y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 11 }, color: '#7a5c3a' } }
      }
    }
  });
}

// ── TABLE ───────────────────────────────────────────────────────
function renderTable() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const year = document.getElementById('filter-year').value;
  const cat = document.getElementById('filter-cat').value;

  let filtered = expenses.filter(e => {
    const ms = !search || e.provider.toLowerCase().includes(search) || e.description.toLowerCase().includes(search);
    return ms && (!year || String(e.year) === year) && (!cat || e.category === cat);
  }).sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('expense-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--driftwood)">No expenses found</td></tr>'; return;
  }
  tbody.innerHTML = filtered.map(e => {
    const col = CAT_COLORS[e.category] || '#888';
    const d = new Date(e.date + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    const receipt = e.receipt_url
      ? `<a class="receipt-link" href="${e.receipt_url}" target="_blank">${e.receipt_name && e.receipt_name.endsWith('.pdf') ? '📄' : '🖼'} View</a>`
      : `<span style="color:var(--driftwood);font-size:12px">—</span>`;
    return `<tr>
      <td style="color:var(--bark);font-size:13px">${d}</td>
      <td style="font-weight:600">${e.provider}</td>
      <td style="color:var(--bark)">${e.description}</td>
      <td><span class="category-badge" style="background:${col}22;color:${col}">${e.category}</span></td>
      <td class="amount-cell">${fmt(e.amount)}</td>
      <td>${receipt}</td>
      <td><button class="delete-btn" onclick="deleteExpense('${e.id}')">✕</button></td>
    </tr>`;
  }).join('');
}

async function deleteExpense(id) {
  if (id.startsWith('local-') || isLocalMode || !supabaseClient) {
    expenses = expenses.filter(e => e.id !== id);
    removeLocalExpense(id);
    renderAll();
    toast('Local expense deleted');
    return;
  }
  if (!confirm('Remove this expense?')) return;
  setSyncing(true);
  try {
    const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
    if (error) throw error;
    expenses = expenses.filter(e => e.id !== id);
    setSyncing(false);
    renderAll();
    toast('Expense deleted');
    notifySpreadsheetEmail('delete', { id });
  } catch (e) {
    setSyncing(false, true);
    toast('Error: ' + e.message, true);
  }
}

// ── PROVIDERS ───────────────────────────────────────────────────
function renderProviders() {
  const data = Object.entries(groupBy(expenses, 'provider'))
    .map(([n, v]) => ({ name: n, total: v.reduce((s, e) => s + Number(e.amount), 0), count: v.length }))
    .sort((a, b) => b.total - a.total);
  const max = Math.max(...data.map(d => d.total));
  document.getElementById('provider-grid').innerHTML = data.map((p, i) => {
    const pct = (p.total / max * 100).toFixed(1);
    return `<div class="provider-card">
      <div class="provider-name">${p.name}</div>
      <div class="provider-total">${fmt(p.total)}</div>
      <div class="provider-bar-wrap"><div class="provider-bar" style="width:${pct}%;background:${PCOLS[i % PCOLS.length]}"></div></div>
      <div class="provider-count">${p.count} transaction${p.count !== 1 ? 's' : ''} · ${pct}% of total</div>
    </div>`;
  }).join('');
}

// ── YEARLY ──────────────────────────────────────────────────────
function renderYearly() {
  const byY = groupBy(expenses, 'year');
  const years = Object.keys(byY).sort();
  const totals = years.map(y => byY[y].reduce((s, e) => s + Number(e.amount), 0));
  document.getElementById('yearly-cards').innerHTML = years.map((y, i) => `
    <div class="card">
      <div class="card-label">${y}</div>
      <div class="card-value">${fmt(totals[i])}</div>
      <div class="card-sub">${byY[y].length} transactions</div>
    </div>`).join('');
  if (charts['yearly']) charts['yearly'].destroy();
  charts['yearly'] = new Chart(document.getElementById('chart-yearly').getContext('2d'), {
    type: 'bar', data: { labels: years, datasets: [{ data: totals, backgroundColor: years.map((_, i) => PCOLS[i]), borderRadius: 10, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 14 }, color: '#7a5c3a' } },
        y: { grid: { color: 'rgba(196,168,130,.2)' }, ticks: { callback: v => '$' + Math.round(v / 1000) + 'k', font: { family: 'Nunito', size: 12 }, color: '#7a5c3a' } }
      }
    }
  });
}

function renderAll() { renderDashboard(); renderTable(); renderProviders(); renderYearly(); }

// ── FILE UPLOAD ─────────────────────────────────────────────────
function handleDragOver(e) { e.preventDefault(); document.getElementById('upload-area').classList.add('drag-over'); }
function handleDragLeave() { document.getElementById('upload-area').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-area').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
}
function handleFileSelect(e) { if (e.target.files[0]) setFile(e.target.files[0]); }

function setFile(file) {
  if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10MB)', true); return; }
  selectedFile = file;
  const icon = file.type === 'application/pdf' ? '📄' : '🖼';
  document.getElementById('upload-file-icon').textContent = icon;
  document.getElementById('upload-file-name').textContent = file.name;
  document.getElementById('upload-area').style.display = 'none';
  document.getElementById('upload-preview').style.display = 'block';
  document.getElementById('upload-progress-bar').style.width = '0%';
  processReceiptFile(file);
}

function clearFile() {
  selectedFile = null;
  document.getElementById('file-input').value = '';
  document.getElementById('upload-area').style.display = 'block';
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-progress-bar').style.width = '0%';
}

async function uploadReceipt(file) {
  const ext = file.name.split('.').pop();
  const path = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  document.getElementById('upload-progress-bar').style.width = '40%';
  const { data, error } = await supabaseClient.storage.from('receipts').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  document.getElementById('upload-progress-bar').style.width = '100%';
  const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(path);
  return { url: urlData.publicUrl, name: file.name };
}

// ── MODAL ───────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('m-date').value = new Date().toISOString().slice(0, 10);
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  ['m-date', 'm-amount', 'm-provider', 'm-desc', 'm-notes'].forEach(id => document.getElementById(id).value = '');
  clearFile();
  document.getElementById('save-btn').disabled = false;
}
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

async function saveExpense(options = {}) {
  const automated = Boolean(options.automated);
  const date = document.getElementById('m-date').value;
  const amount = parseFloat(document.getElementById('m-amount').value);
  const provider = document.getElementById('m-provider').value.trim();
  const desc = document.getElementById('m-desc').value.trim();
  const category = document.getElementById('m-cat').value;
  const notes = document.getElementById('m-notes').value.trim();

  if (!date || !amount || !provider || !desc) {
    if (!automated) toast('Please fill in all required fields', true);
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  if (!isLocalMode && supabaseClient) setSyncing(true);

  try {
    let receipt_url = null;
    let receipt_name = null;

    if (selectedFile && !isLocalMode && supabaseClient) {
      btn.textContent = 'Uploading…';
      const result = await uploadReceipt(selectedFile);
      receipt_url = result.url;
      receipt_name = result.name;
    }

    const newExp = {
      date, amount, provider,
      description: desc,
      category, notes,
      year: parseInt(date.slice(0, 4)),
      receipt_url,
      receipt_name
    };

    if (isLocalMode || !supabaseClient) {
      const localExp = { ...newExp, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
      expenses.unshift(localExp);
      addLocalExpense(localExp);
      setLocalModeSync();
      closeModal();
      renderAll();
      toast(automated ? 'Receipt saved locally ✓' : 'Expense saved locally ✓');
      if (automated) revealSavedExpense(localExp);
      return;
    }

    const { data, error } = await supabaseClient.from('expenses').insert([newExp]).select().single();
    if (error) throw error;

    expenses.unshift(data);
    setSyncing(false);
    closeModal();
    renderAll();
    toast(automated ? 'Receipt saved ✓' : 'Expense saved ✓');
    notifySpreadsheetEmail('insert', data);
    if (automated) revealSavedExpense(data);
  } catch (e) {
    const fallbackExp = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      amount,
      provider,
      description: desc,
      category,
      notes,
      year: parseInt(date.slice(0, 4)),
      receipt_url: null,
      receipt_name: null
    };
    expenses.unshift(fallbackExp);
    addLocalExpense(fallbackExp);
    isLocalMode = true;
    setLocalModeSync();
    closeModal();
    renderAll();
    toast(`Saved locally (sync error: ${e.message})`, true);
    if (automated) revealSavedExpense(fallbackExp);
  }
}

// ── HELPERS ─────────────────────────────────────────────────────
function show(id) { document.getElementById(id).style.display = id === 'app' ? 'block' : 'flex'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

let toastTimer;
function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

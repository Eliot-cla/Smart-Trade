import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, TrendingUp, TrendingDown, Minus, AlertTriangle, Loader2, X, ArrowRight, Target, ShieldAlert, Crosshair, Layers, Clock, Globe2, Grid3x3, Camera, Gauge, ShieldCheck, ChevronRight, Newspaper, Coins, LineChart, Landmark, MessageCircle, ArrowLeft, RefreshCw, Share2, Download } from "lucide-react";

const GOLD = "#C9A648";
const GOLD_BRIGHT = "#E8C973";
const GREEN = "#4FBE83";
const RED = "#D9695F";
const INK = "#08080A";
const PANEL = "#111013";
const LINE = "#232025";
const TEXT = "#EEE9DD";
const MUTE = "#84807A";

// ---------- Supabase (auth + persistent track record) ----------
// The publishable/anon key below is designed to be public — it's safe in
// client code as long as Row Level Security policies are in place on the
// tables it touches (they are, for `analyses`). Never put a secret/service
// key here.
const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wyimfexEpC5t2Ivva3wL1w_sF6W-YT2";

async function supabaseAuthRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error_description || data?.msg || data?.error || `auth_error_${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const signUp = (email, password) => supabaseAuthRequest("signup", { email, password });
const signIn = (email, password) => supabaseAuthRequest("token?grant_type=password", { email, password });

async function supabaseRest(path, { method = "GET", body, accessToken } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: method === "POST" ? "return=representation" : method === "PATCH" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`rest_error_${res.status}:${errBody.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ---------- API layer ----------

function buildSystemPrompt(includeContext) {
  return `You are a technical chart-reading tool for trading screenshots (stocks/crypto/forex). Analyze ONLY what is visibly present in the image (candles, moving averages, RSI, volume, price structure, visible support/resistance, market structure)${includeContext ? ", plus at most one web search for genuinely relevant current macro/news context" : ""}.

Rules:
- Never predict with certainty. Use probabilistic, hypothesis-driven language. Never phrase output as an instruction to execute a trade (no "open your broker", no "take this now").
- "bias" honestly reflects the visible patterns (long/short/neutral). "neutral" is valid and common — never force a direction.
- "entry" is a JSON array of 1 to 2 plain-digit price levels: a single item for a precise level, or two items [from, to] for an entry zone when the structure suggests a range rather than one exact price (this is often more realistic than a single number). "sl" is a single level. Both follow the same plain-digit rule as tp: no thousands separators, no currency symbols, no ranges written as one string.
- "tp" is a JSON array of 1 to 3 indicative take-profit levels (nearest to furthest), each formatted with the same plain-digit rule as entry/sl. Never combine two levels into one string. Use fewer than 3 if only 1-2 targets are visible, or an empty array if none.
- entry/sl/tp: omit uncertain values (use null for entry/sl, omit from the tp array) instead of guessing.
- If the image isn't a usable trading chart: bias "neutral", confidence 0, explain why in "rationale".
- In structureAnalysis.events, include both classical chart patterns (e.g. double top, flag, head & shoulders) AND smart-money-concept structure where visible (Break of Structure / BOS, Change of Character / CHoCH, liquidity sweep or grab, order block, fair value gap, support/resistance flip). Only include what is actually visible — do not invent events.
- Be concise: every string field 1-2 short sentences max. No double quotes inside strings (use single quotes). No trailing commas. Output ONLY valid JSON, nothing else, no markdown fences.
${includeContext ? `- If you search the web, use exactly one focused query max. Summarize in your own words, briefly.` : ""}

JSON shape (exact keys):
{
  "asset": "string or null",
  "detectedTimeframe": "string or null",
  "bias": "long" | "short" | "neutral",
  "confidence": 0-100,
  "entry": ["raw price only"],
  "tp": ["raw price only", "raw price only"],
  "sl": "raw price only, or null",
  "rationale": "2-3 sentences",
  "invalidation": "short sentence",
  "structureAnalysis": {
    "trend": "short description",
    "events": [ { "name": "pattern or SMC concept name", "explanation": "1 short sentence" } ],
    "support": ["level1", "level2"],
    "resistance": ["level1", "level2"]
  },
  "strategy": "2-3 sentences: entry timing, risk mindset, confirmation to wait for",
  "timeframeContext": "1-2 sentences on higher vs lower timeframe read"${includeContext ? `,
  "marketContext": { "summary": "2-3 sentences", "factors": ["short factor 1", "short factor 2"] }` : ""}
}`;
}

async function callClaudeVision(imageBase64, mediaType, includeContext, signal) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: includeContext ? 1700 : 1300,
    system: buildSystemPrompt(includeContext),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Analyze this trading chart screenshot in the exact requested JSON format." },
        ],
      },
    ],
  };
  if (includeContext) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const response = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`api_error_${response.status}:${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(`api_error:${JSON.stringify(data.error).slice(0, 200)}`);

  const textBlocks = (data.content || []).filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n").trim();
  if (!fullText) throw new Error("empty_response");

  let raw = fullText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) throw new Error("no_json_found");
  const jsonSlice = raw.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonSlice);
  } catch (e) {
    throw new Error("json_parse_failed");
  }
}

async function callWithTimeout(imageBase64, mediaType, includeContext, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callClaudeVision(imageBase64, mediaType, includeContext, controller.signal);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeWithRetry(imageBase64, mediaType, includeContext, maxAttempts = 3, timeoutMs = 22000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callWithTimeout(imageBase64, mediaType, includeContext, timeoutMs);
    } catch (err) {
      lastErr = err;
      console.warn(`Analysis attempt ${attempt} failed:`, err.message);
      if (attempt < maxAttempts) {
        // Exponential backoff: transient server-side errors (5xx, proxy
        // hiccups) are more likely to succeed if we actually wait instead
        // of hammering the endpoint immediately again.
        const delay = 500 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ---------- Daily market pulse (independent of chart upload) ----------

const NEWS_SYSTEM_PROMPT = `You produce a short daily market news digest. Use web search (2-3 focused queries max) to find what is genuinely moving markets today across crypto, equities/macro, and geopolitics/macro-relevant world events (e.g. central bank moves, major economic data, significant geopolitical developments affecting markets).

Rules:
- Purely informational and neutral in tone. Never recommend buying, selling, or any trading action. No price predictions.
- Summarize every item in your own words, briefly (1-2 sentences). Never quote source text directly.
- 5 to 8 items total, spread across categories, most significant first.
- Be concise. Output ONLY valid JSON, no prose before or after, no markdown fences.

JSON shape:
{
  "dateLabel": "e.g. 'Today' or a short date string",
  "items": [
    { "category": "Crypto" | "Equities" | "Macro" | "Geopolitics", "headline": "short headline, own words", "summary": "1-2 sentences, own words" }
  ]
}`;

async function fetchDailyNews(signal) {
  const response = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1400,
      system: NEWS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Give me today's market news digest in the exact requested JSON format." }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`api_error_${response.status}:${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  if (data.error) throw new Error(`api_error:${JSON.stringify(data.error).slice(0, 200)}`);

  const textBlocks = (data.content || []).filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n").trim();
  if (!fullText) throw new Error("empty_response");

  let raw = fullText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) throw new Error("no_json_found");
  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new Error("json_parse_failed");
  }
}

async function fetchDailyNewsWithRetry(maxAttempts = 3, timeoutMs = 25000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fetchDailyNews(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err.name === "AbortError" ? new Error("timeout") : err;
      console.warn(`News fetch attempt ${attempt} failed:`, lastErr.message);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

// Robust price cleanup. The model is instructed to output plain digits
// only, but this stays defensive: it takes the FIRST plain number found
// in the string and nothing else, so two separate values can never be
// accidentally merged into one (which previously produced absurd
// numbers like 6300063000 out of two 5-digit prices).
function extractNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\([^)]*\)/g, "");
  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  if (Number.isNaN(val)) return null;
  if (Math.abs(val) > 50000000) return null; // sanity cap — no real trading price is this large
  return val;
}

function formatPrice(raw) {
  const val = extractNumber(raw);
  if (val === null) return null;
  const decimals = Number.isInteger(val) ? 0 : Math.min(2, (String(val).split(".")[1] || "").length);
  return val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
}

// Normalizes a price field into a clean array of formatted prices,
// whatever shape the model returned (array, object, or a lone value).
function normalizePriceList(value) {
  if (value === null || value === undefined) return [];
  let list;
  if (Array.isArray(value)) list = value;
  else if (typeof value === "object") list = Object.values(value);
  else list = [value];
  return list.map((v) => formatPrice(v)).filter(Boolean).slice(0, 3);
}

// window.storage calls occasionally fail transiently (bridge hiccups —
// e.g. "Unexpected response type") the same way network calls do. Retry
// with backoff instead of treating the first failure as final.
async function withStorageRetry(fn, attempts = 3, baseDelay = 400) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`Storage op attempt ${i} failed:`, err.message || err);
      if (i < attempts) await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, i - 1)));
    }
  }
  throw lastErr;
}

function resizeImage(file, maxDim = 1150, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Staged progress (for perceived speed + status while waiting) ----------

function useStagedProgress(active, stages) {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState(stages[0]?.label || "");

  useEffect(() => {
    if (!active) { setProgress(0); setLabel(stages[0]?.label || ""); return; }
    let cancelled = false;
    let current = 0;
    const cap = 96;
    const tick = () => {
      if (cancelled) return;
      current = Math.min(current + (2 + Math.random() * 3), cap);
      setProgress(current);
      const stage = [...stages].reverse().find((s) => current >= s.at);
      if (stage) setLabel(stage.label);
      if (current < cap) setTimeout(tick, 380);
    };
    const t = setTimeout(tick, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [active]);

  const complete = useCallback(() => setProgress(100), []);
  return { progress, label, complete };
}

// ---------- App ----------

export default function SmartTrade() {
  const [view, setView] = useState("welcome"); // 'welcome' | 'pricing' | 'landing' | 'app' | 'news' | 'auth'
  const [session, setSession] = useState(null); // { accessToken, email } | null
  const [authMode, setAuthMode] = useState("signup"); // 'signup' | 'signin'
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);

  // Remember the session across page reloads via localStorage — a real
  // deployed site, unlike the Claude artifact sandbox, supports this.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("smarttrade_session");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.accessToken) setSession(saved);
      }
    } catch {
      // no saved session — just start logged out
    }
  }, []);

  const persistSession = (s) => {
    try {
      localStorage.setItem("smarttrade_session", JSON.stringify(s));
    } catch {
      // non-blocking — worst case the person has to log in again next time
    }
  };

  const handleAuth = async () => {
    setAuthError(null);
    setAuthNotice(null);
    if (!authEmail || !authPassword) {
      setAuthError("Enter both an email and a password.");
      return;
    }
    setAuthLoading(true);
    try {
      if (authMode === "signup") {
        const data = await signUp(authEmail, authPassword);
        if (data?.access_token) {
          const s = { accessToken: data.access_token, email: authEmail };
          setSession(s);
          persistSession(s);
          setView("pricing");
        } else {
          // Email confirmation is likely required before a session is issued
          setAuthNotice("Account created — check your email to confirm it, then sign in below.");
          setAuthMode("signin");
        }
      } else {
        const data = await signIn(authEmail, authPassword);
        const s = { accessToken: data.access_token, email: authEmail };
        setSession(s);
        persistSession(s);
        setView("pricing");
      }
    } catch (err) {
      console.error("Auth failed:", err);
      setAuthError(String(err.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const logOut = () => {
    setSession(null);
    try { localStorage.removeItem("smarttrade_session"); } catch {}
    setView("welcome");
  };

  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [includeContext, setIncludeContext] = useState(false);
  const fileInputRef = useRef(null);
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [newsFetchedAt, setNewsFetchedAt] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [evaluatingId, setEvaluatingId] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  // Maps between the app's camelCase record shape and the DB's
  // snake_case columns.
  const dbRowToRecord = (row) => ({
    id: row.id,
    ts: row.ts ? new Date(row.ts).getTime() : Date.now(),
    thumbnail: row.thumbnail || null,
    asset: row.asset || null,
    detectedTimeframe: row.detected_timeframe || null,
    bias: row.bias || "neutral",
    confidence: row.confidence,
    entry: row.entry || [],
    tp: row.tp || [],
    sl: row.sl || null,
    outcome: row.outcome || "pending",
  });

  const recordToDbInsert = (record) => ({
    thumbnail: record.thumbnail,
    asset: record.asset,
    detected_timeframe: record.detectedTimeframe,
    bias: record.bias,
    confidence: record.confidence,
    entry: record.entry,
    tp: record.tp,
    sl: record.sl,
    outcome: record.outcome,
  });

  const loadHistory = async () => {
    if (!session?.accessToken) {
      setHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const rows = await supabaseRest("analyses?select=*&order=ts.desc", { accessToken: session.accessToken });
      setHistoryItems((rows || []).map(dbRowToRecord));
      setStorageUnavailable(false);
    } catch (err) {
      console.warn("Couldn't load history from Supabase:", err);
      setStorageUnavailable(true);
      // Keep whatever is already in local state rather than wiping it.
    } finally {
      setHistoryLoading(false);
    }
  };

  const updateOutcome = async (id, outcome) => {
    const record = historyItems.find((h) => h.id === id);
    if (!record) return;
    const updated = { ...record, outcome };
    setHistoryItems((prev) => prev.map((h) => (h.id === id ? updated : h)));
    if (!session?.accessToken) return;
    try {
      await supabaseRest(`analyses?id=eq.${id}`, { method: "PATCH", body: { outcome }, accessToken: session.accessToken });
      setStorageUnavailable(false);
    } catch (err) {
      console.warn("Couldn't persist outcome update:", err);
      setStorageUnavailable(true);
    }
  };

  const deleteHistoryItem = async (id) => {
    setHistoryItems((prev) => prev.filter((h) => h.id !== id));
    if (!session?.accessToken) return;
    try {
      await supabaseRest(`analyses?id=eq.${id}`, { method: "DELETE", accessToken: session.accessToken });
    } catch (err) {
      console.warn("Couldn't delete from Supabase:", err);
    }
  };

  const [newsErrorDetail, setNewsErrorDetail] = useState(null);

  const loadNews = async (force = false) => {
    if (!force && news && newsFetchedAt && Date.now() - newsFetchedAt < 30 * 60 * 1000) return;
    setNewsLoading(true);
    setNewsError(null);
    setNewsErrorDetail(null);
    try {
      const data = await fetchDailyNewsWithRetry(3, 15000);
      setNews(data);
      setNewsFetchedAt(Date.now());
    } catch (err) {
      console.error("News fetch failed:", err);
      setNewsErrorDetail(String(err?.message || err || "unknown_error"));
      setNewsError("Couldn't load today's digest.");
    } finally {
      setNewsLoading(false);
    }
  };

  const stages = includeContext
    ? [{ at: 0, label: "Reading structure…" }, { at: 25, label: "Detecting patterns…" }, { at: 50, label: "Checking market context…" }, { at: 75, label: "Cross-referencing levels…" }, { at: 92, label: "Finalizing read…" }]
    : [{ at: 0, label: "Reading structure…" }, { at: 30, label: "Detecting patterns…" }, { at: 65, label: "Cross-referencing levels…" }, { at: 92, label: "Finalizing read…" }];

  const { progress, label, complete } = useStagedProgress(loading, stages);

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setError(null);
    setResult(null);
    try {
      const { dataUrl, base64, mediaType: mt } = await resizeImage(file);
      setImageBase64(base64);
      setMediaType(mt);
      setImage(dataUrl);
    } catch (err) {
      console.error("Image processing failed:", err);
      setError("This image couldn't be processed. Try a different screenshot.");
    }
  };

  const handleDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };

  const reset = () => { setImage(null); setImageBase64(null); setResult(null); setError(null); setSavedToHistory(false); };

  const [rawErrorDetail, setRawErrorDetail] = useState(null);

  // Small thumbnail for history cards — the full-size image isn't needed
  // there, and keeping stored records light matters since storage is
  // per-key size limited and we may accumulate many entries over time.
  const makeThumbnail = (dataUrl) =>
    new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const size = 96;
          const canvas = document.createElement("canvas");
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const sw = size / scale, sh = size / scale;
          const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
          resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      } catch {
        resolve(null);
      }
    });

  // ---------- Share card (Story-format export for social) ----------

  const loadImageEl = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const waitForFonts = async () => {
    try {
      if (document.fonts) {
        await Promise.all([
          document.fonts.load("700 90px Fraunces"),
          document.fonts.load("600 44px Fraunces"),
          document.fonts.load("700 32px Inter"),
          document.fonts.load("600 30px Inter"),
          document.fonts.load("400 26px Inter"),
        ]);
        await document.fonts.ready;
      }
    } catch {
      // fonts will just fall back to system serif/sans-serif — fine
    }
  };

  const drawRoundedRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const generateShareCard = async (res, chartImage) => {
    await waitForFonts();
    const cfg = biasConfig[res.bias] || biasConfig.neutral;
    const W = 1080, H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, 700);
    grad.addColorStop(0, cfg.color + "22");
    grad.addColorStop(1, INK + "00");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 700);

    // Wordmark
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.font = "700 30px Inter, sans-serif";
    ctx.fillText("S M A R T   T R A D E", W / 2, 130);

    // Chart thumbnail
    if (chartImage) {
      try {
        const img = await loadImageEl(chartImage);
        const boxX = 80, boxY = 190, boxW = W - 160, boxH = 560, radius = 20;
        ctx.save();
        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, radius);
        ctx.clip();
        const scale = Math.max(boxW / img.width, boxH / img.height);
        const sw = boxW / scale, sh = boxH / scale;
        const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, boxX, boxY, boxW, boxH);
        ctx.restore();
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, radius);
        ctx.stroke();
      } catch {
        // skip the thumbnail if it can't be loaded, rest of the card still works
      }
    }

    // Direction
    ctx.fillStyle = cfg.color;
    ctx.font = "600 130px Fraunces, serif";
    ctx.fillText(cfg.label, W / 2, 940);

    ctx.fillStyle = MUTE;
    ctx.font = "400 30px Inter, sans-serif";
    const sub = [res.asset, res.detectedTimeframe].filter(Boolean).join("  ·  ") || cfg.sub;
    ctx.fillText(sub, W / 2, 990);

    // Confidence
    if (res.confidence !== undefined && res.confidence !== null) {
      ctx.fillStyle = GOLD_BRIGHT;
      ctx.font = "700 34px Inter, sans-serif";
      ctx.fillText(`${res.confidence}% confidence`, W / 2, 1050);
    }

    // Entry / TP / SL row
    const rowY = 1120, rowH = 220, gap = 24, colW = (W - 160 - gap * 2) / 3;
    const cols = [
      { x: 80, label: "ENTRY", color: GOLD_BRIGHT, value: normalizePriceList(res.entry).join(" – ") || "—" },
      { x: 80 + colW + gap, label: "TP", color: GREEN, value: normalizePriceList(res.tp).slice(0, 1).join("") || "—" },
      { x: 80 + (colW + gap) * 2, label: "SL", color: RED, value: formatPrice(res.sl) || "—" },
    ];
    cols.forEach((c) => {
      ctx.fillStyle = PANEL;
      drawRoundedRect(ctx, c.x, rowY, colW, rowH, 18);
      ctx.fill();
      ctx.strokeStyle = c.color + "66";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, c.x, rowY, colW, rowH, 18);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = c.color;
      ctx.font = "700 26px Inter, sans-serif";
      ctx.fillText(c.label, c.x + colW / 2, rowY + 60);

      ctx.fillStyle = TEXT;
      ctx.font = "600 34px Fraunces, serif";
      const val = c.value.length > 13 ? c.value.slice(0, 13) + "…" : c.value;
      ctx.fillText(val, c.x + colW / 2, rowY + 130);
    });

    // Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "#5A564E";
    ctx.font = "400 24px Inter, sans-serif";
    wrapText(ctx, "Indicative technical read, not financial advice.", W / 2, H - 140, W - 200, 32);
    ctx.fillStyle = GOLD;
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText("SMART TRADE", W / 2, H - 70);

    return canvas.toDataURL("image/png");
  };

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    let lines = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  }

  const [generatingShare, setGeneratingShare] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const handleShare = async (res, chartImage) => {
    setGeneratingShare(true);
    try {
      const url = await generateShareCard(res, chartImage);
      setShareImageUrl(url);
      setShowShareModal(true);
    } catch (err) {
      console.error("Couldn't generate share card:", err);
    } finally {
      setGeneratingShare(false);
    }
  };

  const shareNatively = async () => {
    if (!shareImageUrl) return;
    try {
      const blob = await (await fetch(shareImageUrl)).blob();
      const file = new File([blob], "smart-trade-analysis.png", { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Smart Trade analysis" });
        return;
      }
    } catch (err) {
      console.warn("Native share unavailable or cancelled:", err);
    }
  };

  const [savingToHistory, setSavingToHistory] = useState(false);
  const [savedToHistory, setSavedToHistory] = useState(false);

  const saveToHistory = async (parsed, chartImage) => {
    setSavingToHistory(true);
    const thumbnail = await makeThumbnail(chartImage);
    const record = {
      id: `local-${Date.now()}`, // temporary id, replaced once the DB confirms the insert
      ts: Date.now(),
      thumbnail,
      asset: parsed.asset || null,
      detectedTimeframe: parsed.detectedTimeframe || null,
      bias: parsed.bias || "neutral",
      confidence: parsed.confidence ?? null,
      entry: normalizePriceList(parsed.entry),
      tp: normalizePriceList(parsed.tp),
      sl: formatPrice(parsed.sl),
      outcome: "pending", // 'pending' | 'win' | 'loss' | 'invalid'
    };

    // Show it as saved immediately — the Track Record screen reads from
    // this same in-memory list, so it's available right away regardless
    // of network timing.
    setHistoryItems((prev) => [record, ...prev]);
    setSavedToHistory(true);
    setSavingToHistory(false);

    if (!session?.accessToken) {
      // No account — keep it local to this session only, nothing to sync to.
      setStorageUnavailable(true);
      return true;
    }

    try {
      const rows = await supabaseRest("analyses", { method: "POST", body: recordToDbInsert(record), accessToken: session.accessToken });
      const saved = rows?.[0];
      if (saved) {
        // Swap the temporary local id for the real database id so later
        // outcome updates and deletes target the right row.
        setHistoryItems((prev) => prev.map((h) => (h.id === record.id ? dbRowToRecord(saved) : h)));
      }
      setStorageUnavailable(false);
    } catch (err) {
      console.warn("Background persistence to Supabase failed, entry kept in session only:", err);
      setStorageUnavailable(true);
    }
    return true;
  };

  const analyze = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    setRawErrorDetail(null);
    setResult(null);
    setSavedToHistory(false);
    try {
      let parsed;
      try {
        parsed = await analyzeWithRetry(imageBase64, mediaType, includeContext, 3, includeContext ? 25000 : 20000);
      } catch (firstErr) {
        if (includeContext) {
          console.warn("Context-enabled analysis failed, retrying without context:", firstErr.message);
          try {
            parsed = await analyzeWithRetry(imageBase64, mediaType, false, 2, 20000);
          } catch (secondErr) {
            throw secondErr;
          }
        } else {
          throw firstErr;
        }
      }
      complete();
      await new Promise((r) => setTimeout(r, 220));
      setResult(parsed);
    } catch (err) {
      console.error("Analysis failed after retries:", err);
      const msg = String(err.message || err || "unknown_error");
      setRawErrorDetail(msg);
      setError(
        msg === "timeout"
          ? "The analysis is taking too long and was stopped. Try again with market context turned off."
          : msg.toLowerCase().includes("internal server error") || msg.startsWith("api_error")
          ? "The API connection hit a temporary server error — this isn't specific to your image. Please try again in a moment."
          : "The analysis couldn't be completed. See technical details below."
      );
    } finally {
      setLoading(false);
    }
  };

  const biasConfig = {
    long: { label: "LONG", sub: "Structure leans bullish", color: GREEN, Icon: TrendingUp },
    short: { label: "SHORT", sub: "Structure leans bearish", color: RED, Icon: TrendingDown },
    neutral: { label: "NEUTRAL", sub: "No clear signal", color: GOLD, Icon: Minus },
  };

  const sharedStyles = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,340;9..144,480;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      .disp { font-family: 'Fraunces', serif; }
      .mono { font-family: 'Inter', sans-serif; font-variant-numeric: tabular-nums; }
      .btn { transition: transform .15s ease, opacity .15s ease, border-color .15s ease; cursor: pointer; }
      .btn:hover { transform: translateY(-1px); }
      .btn:active { transform: translateY(0); }
      .dz { transition: border-color .2s ease, background .2s ease; }
      .fade { animation: fadeUp .45s cubic-bezier(.22,1,.36,1) both; }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes scanMove { 0% { top: -8%; } 50% { top: 100%; } 100% { top: -8%; } }
      @keyframes scanPulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
      .scan-line { position: absolute; left: 0; right: 0; height: 3px;
        background: linear-gradient(90deg, transparent, ${GOLD_BRIGHT}, ${GOLD}, ${GOLD_BRIGHT}, transparent);
        box-shadow: 0 0 16px 3px ${GOLD}AA, 0 0 40px 8px ${GOLD}44;
        animation: scanMove 2.1s ease-in-out infinite, scanPulse 2.1s ease-in-out infinite; }
      .scan-tint { position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        background: linear-gradient(180deg, ${GOLD}00, ${GOLD}0D, ${GOLD}00); }
      ::selection { background: ${GOLD}; color: ${INK}; }
      input[type=checkbox].gold-check { accent-color: ${GOLD}; width: 15px; height: 15px; }
      .progress-track { height: 4px; background: ${LINE}; border-radius: 3px; overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, ${GOLD}, ${GOLD_BRIGHT}); border-radius: 3px; transition: width .35s ease; }
    `}</style>
  );

  // ---------- WELCOME ----------
  if (view === "welcome") {
    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        {sharedStyles}

        {/* Ambient background: glow + faint upward trend line, purely decorative */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: "18%", left: "50%", transform: "translate(-50%, -50%)", width: 620, height: 620, background: `radial-gradient(circle, ${GOLD}20, transparent 70%)` }} />
          <svg viewBox="0 0 400 200" preserveAspectRatio="none" style={{ position: "absolute", bottom: "8%", left: 0, width: "100%", height: 220, opacity: 0.35 }}>
            <polyline
              points="0,170 60,150 100,160 140,100 180,120 220,60 260,80 300,30 340,45 400,10"
              fill="none" stroke={GOLD} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 24px", textAlign: "center", position: "relative" }}>
          <div className="fade" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 22 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Welcome</span>
          </div>
          <h1 className="disp fade" style={{ fontSize: 56, fontWeight: 480, margin: "0 0 18px", letterSpacing: -1, lineHeight: 1.02, animationDelay: ".05s" }}>
            Smart <span style={{ color: GOLD_BRIGHT, fontStyle: "italic" }}>Trade</span>
          </h1>
          <p className="mono fade" style={{ color: MUTE, fontSize: 15, lineHeight: 1.7, margin: "0 auto 40px", maxWidth: 380, animationDelay: ".1s" }}>
            A clear, structured technical read of your charts — direction, indicative entry/TP/SL, and market structure, explained in plain language.
          </p>
          <button
            onClick={() => setView("landing")}
            className="btn mono fade"
            style={{
              width: "100%", padding: "16px 20px", background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
              color: INK, border: "none", borderRadius: 6, fontSize: 14.5, fontWeight: 700, letterSpacing: 0.4,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, animationDelay: ".18s",
              boxShadow: `0 8px 30px -8px ${GOLD}66`,
            }}
          >
            Get started <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ---------- PRICING ----------
  if (view === "pricing") {
    const plans = [
      { id: "pack", name: "Starter Pack", price: "19.99 €", period: "one-time", tag: null, desc: "50 chart analyses, no expiry.", features: ["50 analyses", "Full structure breakdown", "Market context toggle"] },
      { id: "pack2", name: "Growth Pack", price: "29.99 €", period: "one-time", tag: null, desc: "75 chart analyses, no expiry.", features: ["75 analyses", "Full structure breakdown", "Market context toggle"] },
      { id: "monthly", name: "Unlimited Monthly", price: "39.99 €", period: "/ month", tag: "Most popular", desc: "Unlimited analyses, cancel anytime.", features: ["Unlimited analyses", "Full structure breakdown", "Market context toggle", "Priority processing"] },
      { id: "annual", name: "Unlimited Annual", price: "299.99 €", period: "/ year", tag: "Save €180", desc: "Same as monthly, billed once a year.", features: ["Unlimited analyses", "Full structure breakdown", "Market context toggle", "Priority processing"] },
    ];
    const planIcon = { pack: Coins, pack2: Layers, monthly: Gauge, annual: Clock };
    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", position: "relative", overflow: "hidden" }}>
        {sharedStyles}
        <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 500, height: 400, background: `radial-gradient(circle, ${GOLD}18, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 20px 60px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Plans</span>
          </div>
          <h1 className="disp" style={{ fontSize: 32, fontWeight: 480, margin: "6px 0 10px", letterSpacing: -0.3, lineHeight: 1.1 }}>
            Choose how you read charts.
          </h1>
          <p className="mono" style={{ color: MUTE, fontSize: 14, lineHeight: 1.6, margin: "0 0 28px" }}>
            Start with a pack, or go unlimited monthly or yearly.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {plans.map((p) => {
              const PlanIcon = planIcon[p.id] || Coins;
              return (
              <div key={p.id} style={{
                background: p.id === "monthly" ? `linear-gradient(180deg, ${GOLD}12, ${PANEL})` : PANEL,
                border: `1px solid ${p.id === "monthly" ? GOLD + "55" : LINE}`, borderRadius: 10, padding: 20, position: "relative",
              }}>
                {p.tag && (
                  <span className="mono" style={{
                    position: "absolute", top: -10, right: 18, background: p.id === "monthly" ? GOLD : GREEN, color: INK,
                    fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, letterSpacing: 0.3,
                  }}>{p.tag}</span>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: (p.id === "monthly" ? GOLD : MUTE) + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <PlanIcon size={13} color={p.id === "monthly" ? GOLD_BRIGHT : MUTE} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flex: 1 }}>
                    <span className="mono" style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 12, color: MUTE }}>{p.period}</span>
                  </div>
                </div>
                <div className="disp" style={{ fontSize: 28, fontWeight: 600, color: p.id === "monthly" ? GOLD_BRIGHT : TEXT, marginBottom: 8 }}>{p.price}</div>
                <p className="mono" style={{ fontSize: 12.5, color: MUTE, margin: "0 0 12px", lineHeight: 1.5 }}>{p.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
                  {p.features.map((f, i) => (
                    <div key={i} className="mono" style={{ fontSize: 12, color: TEXT, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: GOLD, flexShrink: 0 }} /> {f}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setView("app")}
                  className="btn mono"
                  style={{
                    width: "100%", padding: "11px 16px", borderRadius: 5, fontSize: 13, fontWeight: 600,
                    background: p.id === "monthly" ? `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})` : "transparent",
                    color: p.id === "monthly" ? INK : TEXT, border: p.id === "monthly" ? "none" : `1px solid ${LINE}`,
                  }}
                >
                  Choose {p.name}
                </button>
              </div>
              );
            })}
          </div>

          <button onClick={() => setView("app")} className="btn mono" style={{ width: "100%", padding: 10, background: "transparent", border: "none", color: MUTE, fontSize: 12.5, textDecoration: "underline", textUnderlineOffset: 3 }}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ---------- LANDING ----------
  if (view === "landing") {
    const features = [
      { Icon: Camera, title: "Screenshot in, read out", text: "Drop any TradingView screenshot — no manual setup, no indicators to configure." },
      { Icon: Gauge, title: "Direction, entry, TP, SL", text: "A clear indicative read: bias, entry zone, take-profit and stop-loss levels." },
      { Icon: Grid3x3, title: "Real structure, explained", text: "Support, resistance, breaks of structure, liquidity sweeps — named and explained, not just charted." },
      { Icon: ShieldCheck, title: "Honest by design", text: "Every read is a pattern-based hypothesis, never a certainty or an order to trade." },
      { Icon: Newspaper, title: "Daily market pulse", text: "A short daily digest of what's moving crypto, equities and macro — even on days you don't upload a chart." },
    ];
    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif" }}>
        {sharedStyles}
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "64px 20px 90px" }}>
          <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Smart Trade</span>
          </div>

          <h1 className="disp fade" style={{ fontSize: 44, fontWeight: 480, margin: "0 0 16px", letterSpacing: -0.5, lineHeight: 1.06, animationDelay: ".05s" }}>
            Read your chart<br />before you enter.
          </h1>
          <p className="mono fade" style={{ color: MUTE, fontSize: 15.5, lineHeight: 1.7, maxWidth: 480, margin: "0 0 28px", animationDelay: ".1s" }}>
            Smart Trade turns a TradingView screenshot into a clear, structured technical read — direction, indicative entry/TP/SL, market structure, and (optionally) live macro context. Built for traders who want a second pair of eyes, not a black box telling them what to do.
          </p>

          {/* Example preview — shows the actual output shape instead of just describing it */}
          <div className="fade" style={{ marginBottom: 32, animationDelay: ".12s" }}>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1.5, color: "#5A564E", marginBottom: 8, textTransform: "uppercase" }}>Example read</div>
            <div style={{ background: `linear-gradient(180deg, ${GREEN}12, transparent)`, border: `1px solid ${GREEN}3D`, borderRadius: 10, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: GREEN + "1A", border: `1px solid ${GREEN}55`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <TrendingUp size={15} color={GREEN} strokeWidth={2.4} />
                  </div>
                  <div>
                    <div className="disp" style={{ fontSize: 19, fontWeight: 600, color: GREEN, lineHeight: 1 }}>LONG</div>
                    <div className="mono" style={{ fontSize: 10.5, color: MUTE, marginTop: 2 }}>BTC/USD · 1H</div>
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: MUTE }}>72% confidence</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: INK, borderRadius: 6, padding: "9px 8px", border: `1px solid ${LINE}` }}>
                  <div className="mono" style={{ fontSize: 9, color: MUTE, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Entry</div>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: TEXT }}>63,800–64,200</div>
                </div>
                <div style={{ background: INK, borderRadius: 6, padding: "9px 8px", border: `1px solid ${GREEN}33` }}>
                  <div className="mono" style={{ fontSize: 9, color: GREEN, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>TP1</div>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: TEXT }}>65,900</div>
                </div>
                <div style={{ background: INK, borderRadius: 6, padding: "9px 8px", border: `1px solid ${RED}33` }}>
                  <div className="mono" style={{ fontSize: 9, color: RED, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>SL</div>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: TEXT }}>62,900</div>
                </div>
              </div>
            </div>
            <p className="mono" style={{ fontSize: 10.5, color: "#5A564E", marginTop: 8, lineHeight: 1.5 }}>
              Illustrative example — not a live signal.
            </p>
          </div>

          <div className="fade" style={{ display: "grid", gap: 12, marginBottom: 36, animationDelay: ".15s" }}>
            {features.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 14, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: "16px 18px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: GOLD + "14", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <f.Icon size={16} color={GOLD} />
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: TEXT, marginBottom: 3 }}>{f.title}</div>
                  <div className="mono" style={{ fontSize: 12.5, color: MUTE, lineHeight: 1.55 }}>{f.text}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setView("auth")}
            className="btn mono fade"
            style={{
              width: "100%", padding: "16px 20px", background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
              color: INK, border: "none", borderRadius: 6, fontSize: 14.5, fontWeight: 700, letterSpacing: 0.4,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, animationDelay: ".2s",
            }}
          >
            Create account <ChevronRight size={16} />
          </button>

          <p className="mono" style={{ fontSize: 11, color: "#5A564E", marginTop: 16, lineHeight: 1.6, textAlign: "center" }}>
            Educational chart-reading tool. Not financial advice, not a signal to trade.
          </p>
        </div>
      </div>
    );
  }

  // ---------- NEWS (independent daily digest, unrelated to chart upload) ----------
  if (view === "news") {
    const categoryIcon = { Crypto: Coins, Equities: LineChart, Macro: Landmark, Geopolitics: Globe2 };
    const categoryColor = { Crypto: GOLD, Equities: GREEN, Macro: "#7FB4D9", Geopolitics: RED };
    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", position: "relative", overflow: "hidden" }}>
        {sharedStyles}
        <div style={{ position: "absolute", top: -60, left: "70%", transform: "translateX(-50%)", width: 460, height: 380, background: `radial-gradient(circle, ${GOLD}16, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 20px 90px", position: "relative" }}>
          <button onClick={() => setView("app")} className="btn mono" style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: MUTE, fontSize: 12.5, padding: 0, marginBottom: 22 }}>
            <ArrowLeft size={14} /> Back
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Market Pulse</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <h1 className="disp" style={{ fontSize: 32, fontWeight: 480, margin: "6px 0 0", letterSpacing: -0.3 }}>
              {news?.dateLabel || "Today"}'s digest
            </h1>
            <button onClick={() => loadNews(true)} disabled={newsLoading} className="btn mono" style={{ background: "transparent", border: "none", color: MUTE, display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: 0 }}>
              <RefreshCw size={13} style={newsLoading ? { animation: "spin 1s linear infinite" } : {}} /> Refresh
            </button>
          </div>
          <p className="mono" style={{ color: MUTE, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 28px" }}>
            What's moving crypto, equities and macro today — independent of any chart you upload.
          </p>

          {newsLoading && (
            <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 78, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, opacity: 1 - i * 0.15 }} />
              ))}
              <div className="mono" style={{ textAlign: "center", fontSize: 12.5, color: MUTE, marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Gathering today's headlines…
              </div>
            </div>
          )}

          {!newsLoading && newsError && (
            <div className="mono fade" style={{ padding: 14, background: RED + "14", border: `1px solid ${RED}44`, borderRadius: 5, fontSize: 13, color: RED }}>
              <div>{newsError}</div>
              {newsErrorDetail && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 11.5, color: RED + "CC" }}>Technical details</summary>
                  <div style={{ marginTop: 8, padding: 10, background: INK, borderRadius: 4, fontSize: 11, color: MUTE, wordBreak: "break-all", userSelect: "text" }}>
                    {newsErrorDetail}
                  </div>
                </details>
              )}
              <button onClick={() => loadNews(true)} className="btn mono" style={{ display: "block", marginTop: 10, background: "transparent", border: `1px solid ${RED}44`, borderRadius: 4, padding: "7px 12px", color: RED, fontSize: 12 }}>
                Try again
              </button>
            </div>
          )}

          {!newsLoading && !newsError && news?.items?.length > 0 && (
            <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {news.items.map((item, i) => {
                const CatIcon = categoryIcon[item.category] || Globe2;
                const color = categoryColor[item.category] || GOLD;
                return (
                  <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${color}88`, borderRadius: 8, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                      <CatIcon size={12} color={color} />
                      <span className="mono" style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: 1, textTransform: "uppercase" }}>{item.category}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 5, lineHeight: 1.4 }}>{item.headline}</div>
                    <div className="mono" style={{ fontSize: 12.5, color: MUTE, lineHeight: 1.55 }}>{item.summary}</div>
                  </div>
                );
              })}
              <p className="mono" style={{ fontSize: 11, color: "#5A564E", marginTop: 6, lineHeight: 1.6 }}>
                General market information, not investment advice. Always cross-check independently.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- HISTORY / TRACK RECORD ----------
  if (view === "history") {
    const wins = historyItems.filter((h) => h.outcome === "win").length;
    const losses = historyItems.filter((h) => h.outcome === "loss").length;
    const invalid = historyItems.filter((h) => h.outcome === "invalid").length;
    const pending = historyItems.filter((h) => h.outcome === "pending").length;
    const decided = wins + losses;
    const winRate = decided > 0 ? Math.round((wins / decided) * 100) : null;

    const outcomeStyle = {
      win: { label: "TP hit", color: GREEN },
      loss: { label: "SL hit", color: RED },
      invalid: { label: "Invalidated", color: MUTE },
      pending: { label: "Pending", color: GOLD },
    };

    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", position: "relative", overflow: "hidden" }}>
        {sharedStyles}
        <div style={{ position: "absolute", top: -60, left: "30%", transform: "translateX(-50%)", width: 460, height: 380, background: `radial-gradient(circle, ${GOLD}16, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 20px 90px", position: "relative" }}>
          <button onClick={() => setView("app")} className="btn mono" style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: MUTE, fontSize: 12.5, padding: 0, marginBottom: 22 }}>
            <ArrowLeft size={14} /> Back
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Track record</span>
          </div>
          <h1 className="disp" style={{ fontSize: 32, fontWeight: 480, margin: "6px 0 20px", letterSpacing: -0.3 }}>
            Every read, kept honest.
          </h1>

          {/* Stats bar */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 24 }}>
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderTopWidth: 2, borderTopColor: GOLD + "88", borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: winRate === null ? MUTE : GOLD_BRIGHT }}>{winRate === null ? "—" : `${winRate}%`}</div>
              <div className="mono" style={{ fontSize: 9.5, color: MUTE, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 }}>Win rate</div>
            </div>
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderTopWidth: 2, borderTopColor: GREEN + "88", borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: GREEN }}>{wins}</div>
              <div className="mono" style={{ fontSize: 9.5, color: MUTE, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 }}>Wins</div>
            </div>
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderTopWidth: 2, borderTopColor: RED + "88", borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: RED }}>{losses}</div>
              <div className="mono" style={{ fontSize: 9.5, color: MUTE, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 }}>Losses</div>
            </div>
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderTopWidth: 2, borderTopColor: LINE, borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 600, color: TEXT }}>{pending}</div>
              <div className="mono" style={{ fontSize: 9.5, color: MUTE, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2 }}>Pending</div>
            </div>
          </div>
          <p className="mono" style={{ fontSize: 11, color: "#5A564E", marginTop: -14, marginBottom: 22, lineHeight: 1.6 }}>
            Self-reported outcomes, stored only on this device — not independently verified.
          </p>

          {historyLoading && historyItems.length === 0 && (
            <div className="mono" style={{ textAlign: "center", padding: 30, color: MUTE, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading history…
            </div>
          )}

          {storageUnavailable && (
            <div className="mono fade" style={{ display: "flex", gap: 8, padding: 12, background: GOLD + "10", border: `1px solid ${GOLD}33`, borderRadius: 5, fontSize: 11.5, color: MUTE, lineHeight: 1.5, marginBottom: 14 }}>
              <AlertTriangle size={13} color={GOLD} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Persistent storage isn't responding right now — entries below are kept for this session, but may not survive closing the app. Nothing you've done has been lost yet.</span>
            </div>
          )}

          {!historyLoading && historyItems.length === 0 && (
            <div className="mono" style={{ textAlign: "center", padding: "40px 20px", color: MUTE, fontSize: 13, lineHeight: 1.6 }}>
              No analyses yet. Once you analyze a chart, save it, and it'll show up here — with the option to mark whether TP or SL ended up hitting.
            </div>
          )}

          {historyItems.length > 0 && (
            <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {historyItems.map((h) => {
                const cfg = biasConfig[h.bias] || biasConfig.neutral;
                const Icon = cfg.Icon;
                const os = outcomeStyle[h.outcome] || outcomeStyle.pending;
                return (
                  <div key={h.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 14, display: "flex", gap: 12 }}>
                    {h.thumbnail ? (
                      <img src={h.thumbnail} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 6, background: INK, flexShrink: 0, border: `1px solid ${LINE}` }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Icon size={12} color={cfg.color} />
                          <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                          {h.asset && <span className="mono" style={{ fontSize: 11.5, color: MUTE }}>· {h.asset}</span>}
                        </div>
                        <span className="mono" style={{ fontSize: 10, color: MUTE }}>{new Date(h.ts).toLocaleDateString()}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: MUTE, marginBottom: 8 }}>
                        Entry {h.entry?.join("–") || "—"} · TP {h.tp?.[0] || "—"} · SL {h.sl || "—"}
                      </div>

                      {h.outcome === "pending" ? (
                        evaluatingId === h.id ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button onClick={() => { updateOutcome(h.id, "win"); setEvaluatingId(null); }} className="btn mono" style={{ fontSize: 10.5, padding: "5px 10px", borderRadius: 20, background: GREEN + "14", border: `1px solid ${GREEN}44`, color: GREEN }}>TP hit</button>
                            <button onClick={() => { updateOutcome(h.id, "loss"); setEvaluatingId(null); }} className="btn mono" style={{ fontSize: 10.5, padding: "5px 10px", borderRadius: 20, background: RED + "14", border: `1px solid ${RED}44`, color: RED }}>SL hit</button>
                            <button onClick={() => { updateOutcome(h.id, "invalid"); setEvaluatingId(null); }} className="btn mono" style={{ fontSize: 10.5, padding: "5px 10px", borderRadius: 20, background: "transparent", border: `1px solid ${LINE}`, color: MUTE }}>Invalidated</button>
                            <button onClick={() => setEvaluatingId(null)} className="btn mono" style={{ fontSize: 10.5, padding: "5px 10px", color: "#5A564E", background: "transparent", border: "none" }}>Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setEvaluatingId(h.id)} className="btn mono" style={{ fontSize: 11, padding: "6px 14px", borderRadius: 20, background: GOLD + "14", border: `1px solid ${GOLD}44`, color: GOLD_BRIGHT, fontWeight: 600 }}>Evaluate</button>
                        )
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ fontSize: 10.5, padding: "4px 10px", borderRadius: 20, background: os.color + "14", border: `1px solid ${os.color}44`, color: os.color, fontWeight: 600 }}>{os.label}</span>
                          <button onClick={() => updateOutcome(h.id, "pending")} className="btn mono" style={{ fontSize: 10.5, color: "#5A564E", background: "transparent", border: "none", textDecoration: "underline" }}>Undo</button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => deleteHistoryItem(h.id)} className="btn" style={{ background: "transparent", border: "none", color: "#5A564E", flexShrink: 0, height: "fit-content" }}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- AUTH (sign up / sign in) ----------
  if (view === "auth") {
    return (
      <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", overflow: "hidden" }}>
        {sharedStyles}
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)", width: 500, height: 500, background: `radial-gradient(circle, ${GOLD}18, transparent 70%)`, pointerEvents: "none" }} />

        <div style={{ maxWidth: 420, margin: "0 auto", padding: "40px 24px", position: "relative", width: "100%" }}>
          <button onClick={() => setView("landing")} className="btn mono" style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: MUTE, fontSize: 12.5, padding: 0, marginBottom: 26 }}>
            <ArrowLeft size={14} /> Back
          </button>

          <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>{authMode === "signup" ? "Create account" : "Welcome back"}</span>
          </div>
          <h1 className="disp fade" style={{ fontSize: 32, fontWeight: 480, margin: "6px 0 24px", letterSpacing: -0.3, lineHeight: 1.1 }}>
            {authMode === "signup" ? "One account, every read saved." : "Sign in to your account."}
          </h1>

          <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="mono"
              style={{ padding: "14px 16px", borderRadius: 6, background: PANEL, border: `1px solid ${LINE}`, color: TEXT, fontSize: 14, outline: "none" }}
            />
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAuth(); }}
              className="mono"
              style={{ padding: "14px 16px", borderRadius: 6, background: PANEL, border: `1px solid ${LINE}`, color: TEXT, fontSize: 14, outline: "none" }}
            />
          </div>

          {authError && (
            <div className="mono fade" style={{ marginBottom: 14, padding: 12, background: RED + "14", border: `1px solid ${RED}44`, borderRadius: 5, fontSize: 12.5, color: RED }}>
              {authError}
            </div>
          )}
          {authNotice && (
            <div className="mono fade" style={{ marginBottom: 14, padding: 12, background: GOLD + "14", border: `1px solid ${GOLD}44`, borderRadius: 5, fontSize: 12.5, color: GOLD_BRIGHT }}>
              {authNotice}
            </div>
          )}

          <button
            onClick={handleAuth}
            disabled={authLoading}
            className="btn mono fade"
            style={{
              width: "100%", padding: "15px 20px", background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
              color: INK, border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, letterSpacing: 0.3,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {authLoading ? (<><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> {authMode === "signup" ? "Creating account…" : "Signing in…"}</>) : (authMode === "signup" ? "Create account" : "Sign in")}
          </button>

          <button
            onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthError(null); setAuthNotice(null); }}
            className="btn mono"
            style={{ width: "100%", padding: 12, marginTop: 10, background: "transparent", border: "none", color: MUTE, fontSize: 12.5 }}
          >
            {authMode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>

          <p className="mono" style={{ fontSize: 10.5, color: "#5A564E", marginTop: 20, textAlign: "center", lineHeight: 1.6 }}>
            Your account keeps your Track Record saved across sessions and devices.
          </p>

          <button
            onClick={() => setView("pricing")}
            className="btn mono"
            style={{ width: "100%", padding: 10, marginTop: 18, background: "transparent", border: `1px dashed ${LINE}`, borderRadius: 5, color: "#5A564E", fontSize: 11.5 }}
          >
            Skip (testing only)
          </button>
        </div>
      </div>
    );
  }

  // ---------- APP ----------
  return (
    <div style={{ minHeight: "100vh", background: INK, color: TEXT, fontFamily: "'Inter', sans-serif", position: "relative", overflow: "hidden" }}>
      {sharedStyles}
      <div style={{ position: "absolute", top: -70, left: "50%", transform: "translateX(-50%)", width: 520, height: 400, background: `radial-gradient(circle, ${GOLD}14, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 20px 90px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Smart Trade</span>
          </div>
          {session && (
            <button onClick={logOut} className="btn mono" style={{ background: "transparent", border: "none", color: "#5A564E", fontSize: 11, padding: 0 }}>
              {session.email} · Log out
            </button>
          )}
        </div>
        <h1 className="disp" style={{ fontSize: 38, fontWeight: 480, margin: "6px 0 10px", letterSpacing: -0.3, lineHeight: 1.08 }}>
          Read your chart before you enter.
        </h1>
        <p className="mono" style={{ color: MUTE, fontSize: 14.5, lineHeight: 1.6, maxWidth: 480, margin: 0 }}>
          Drop a TradingView screenshot. Direction, entry, TP and SL — read from the patterns, not guessed.
        </p>

        {!image && (
          <div
            className="dz"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ marginTop: 32, border: `1px dashed ${LINE}`, borderRadius: 6, padding: "60px 24px", textAlign: "center", cursor: "pointer", background: PANEL }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = GOLD + "66")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = LINE)}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: GOLD + "14", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <Upload size={17} color={GOLD} />
            </div>
            <div className="mono" style={{ fontSize: 14, color: TEXT, marginBottom: 4, fontWeight: 500 }}>Drop your screenshot here</div>
            <div className="mono" style={{ fontSize: 12.5, color: MUTE }}>or click to browse</div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        )}

        {!image && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => { setView("news"); loadNews(false); }}
              className="btn mono"
              style={{
                flex: 1, padding: "12px 12px", background: PANEL, border: `1px solid ${LINE}`,
                borderRadius: 6, color: TEXT, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              <Newspaper size={14} color={GOLD} /> Market news
            </button>
            <button
              onClick={() => { setView("history"); loadHistory(); }}
              className="btn mono"
              style={{
                flex: 1, padding: "12px 12px", background: PANEL, border: `1px solid ${LINE}`,
                borderRadius: 6, color: TEXT, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              <Clock size={14} color={GOLD} /> Track record
            </button>
          </div>
        )}

        {image && (
          <div className="fade" style={{ marginTop: 28, position: "relative", borderRadius: 6, overflow: "hidden" }}>
            <img src={image} alt="Uploaded chart" style={{ width: "100%", borderRadius: 6, border: `1px solid ${loading ? GOLD + "55" : LINE}`, display: "block", transition: "border-color .3s ease" }} />
            {loading && (<><div className="scan-tint" /><div className="scan-line" /></>)}
            {!loading && !result && (
              <button onClick={reset} className="btn" style={{ position: "absolute", top: 10, right: 10, background: INK + "DD", border: `1px solid ${LINE}`, borderRadius: 4, padding: 6, color: TEXT, display: "flex" }}>
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="fade" style={{ marginTop: 16 }}>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: MUTE }}>
              <span>{label}</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        {image && !result && !loading && (
          <>
            <label className="mono" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 12.5, color: MUTE, cursor: "pointer" }}>
              <input type="checkbox" className="gold-check" checked={includeContext} onChange={(e) => setIncludeContext(e.target.checked)} />
              Include market &amp; news context <span style={{ color: "#5A564E" }}>(adds a few seconds)</span>
            </label>

            <button
              onClick={analyze}
              className="btn mono"
              style={{
                marginTop: 12, width: "100%", padding: "15px 20px",
                background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
                color: INK, border: "none", borderRadius: 5, fontSize: 14, fontWeight: 700,
                letterSpacing: 0.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              Analyze chart
            </button>
          </>
        )}

        {error && (
          <div className="mono fade" style={{ marginTop: 16, padding: 14, background: RED + "14", border: `1px solid ${RED}44`, borderRadius: 5, fontSize: 13, color: RED }}>
            <div>{error}</div>
            {rawErrorDetail && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: RED + "CC" }}>Technical details (copy this if it keeps happening)</summary>
                <div style={{ marginTop: 8, padding: 10, background: INK, borderRadius: 4, fontSize: 11, color: MUTE, wordBreak: "break-all", userSelect: "text" }}>
                  {rawErrorDetail}
                </div>
              </details>
            )}
          </div>
        )}

        {result && (() => {
          const cfg = biasConfig[result.bias] || biasConfig.neutral;
          const Icon = cfg.Icon;
          const conf = Math.max(0, Math.min(100, result.confidence ?? 0));
          const sa = result.structureAnalysis || {};
          return (
            <div className="fade" style={{ marginTop: 32 }}>
              {/* 1. HERO — direction + entry/tp/sl */}
              <div style={{ background: `linear-gradient(180deg, ${cfg.color}12, transparent)`, border: `1px solid ${cfg.color}3D`, borderRadius: 10, padding: 18, marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
                  {image && <img src={image} alt="Analyzed chart" style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 6, border: `1px solid ${LINE}`, flexShrink: 0 }} />}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: cfg.color + "1A", border: `1px solid ${cfg.color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={17} color={cfg.color} strokeWidth={2.4} />
                      </div>
                      <div>
                        <div className="disp" style={{ fontSize: 23, fontWeight: 600, color: cfg.color, letterSpacing: 0.5, lineHeight: 1 }}>{cfg.label}</div>
                        <div className="mono" style={{ fontSize: 11.5, color: MUTE, marginTop: 3 }}>{cfg.sub}</div>
                      </div>
                    </div>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0, background: `conic-gradient(${cfg.color} ${conf * 3.6}deg, ${LINE} 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 42, height: 42, borderRadius: "50%", background: INK, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{conf}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mono" style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 12, color: MUTE }}>
                  {result.asset && <span><strong style={{ color: TEXT }}>{result.asset}</strong></span>}
                  {result.detectedTimeframe && <span>· {result.detectedTimeframe}</span>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.3fr 0.85fr", gap: 10 }}>
                  <div style={{ background: `linear-gradient(180deg, ${GOLD}14, ${INK})`, borderRadius: 7, padding: "13px 12px", border: `1px solid ${GOLD}55` }}>
                    <div className="mono" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: GOLD_BRIGHT, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}><Crosshair size={11} /> Entry</div>
                    {(() => {
                      const zone = normalizePriceList(result.entry);
                      if (zone.length === 0) return <div className="disp" style={{ fontSize: 19, fontWeight: 600, color: TEXT }}>—</div>;
                      if (zone.length === 1) return <div className="disp" style={{ fontSize: 19, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{zone[0]}</div>;
                      return (
                        <div className="disp" style={{ fontSize: 15.5, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>
                          {zone[0]}<span style={{ color: GOLD_BRIGHT, margin: "0 3px" }}>–</span>{zone[1]}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ background: `linear-gradient(180deg, ${GREEN}14, ${INK})`, borderRadius: 7, padding: "13px 12px", border: `1px solid ${GREEN}55` }}>
                    <div className="mono" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: GREEN, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}><Target size={11} /> Take profit</div>
                    {(() => {
                      const tps = normalizePriceList(result.tp);
                      if (tps.length === 0) return <div className="disp" style={{ fontSize: 19, fontWeight: 600, color: TEXT }}>—</div>;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {tps.map((lvl, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                              <span className="mono" style={{ fontSize: 10, color: GREEN, fontWeight: 700, opacity: 0.8 }}>TP{i + 1}</span>
                              <span className="disp" style={{ fontSize: 17, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{lvl}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ background: `linear-gradient(180deg, ${RED}14, ${INK})`, borderRadius: 7, padding: "13px 12px", border: `1px solid ${RED}55` }}>
                    <div className="mono" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: RED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}><ShieldAlert size={11} /> Stop loss</div>
                    <div className="disp" style={{ fontSize: 19, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{formatPrice(result.sl) || "—"}</div>
                  </div>
                </div>

                <div className="mono" style={{ marginTop: 12, fontSize: 11, color: MUTE, display: "flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle size={11} /> Indicative levels read from the chart — not a guarantee of execution or outcome.
                </div>
              </div>

              {/* 2. Why this read */}
              <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 20, marginBottom: 14 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: 1.5, color: GOLD, marginBottom: 10, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <ArrowRight size={12} /> Why this read
                </div>
                <p className="mono" style={{ fontSize: 14, lineHeight: 1.65, color: TEXT, margin: 0 }}>{result.rationale}</p>
                {result.invalidation && (
                  <p className="mono" style={{ fontSize: 12.5, lineHeight: 1.6, color: MUTE, margin: "12px 0 0", paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
                    <strong style={{ color: TEXT }}>What would invalidate this: </strong>{result.invalidation}
                  </p>
                )}
              </div>

              {/* 3. Market context */}
              {result.marketContext && (
                <div style={{ background: PANEL, border: `1px solid ${GOLD}33`, borderRadius: 8, padding: 20, marginBottom: 14 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: 1.5, color: GOLD, marginBottom: 10, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                    <Globe2 size={12} /> Market context
                  </div>
                  <p className="mono" style={{ fontSize: 13.5, lineHeight: 1.6, color: TEXT, margin: "0 0 10px" }}>{result.marketContext.summary}</p>
                  {result.marketContext.factors?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {result.marketContext.factors.map((f, i) => (
                        <span key={i} className="mono" style={{ fontSize: 11.5, padding: "5px 11px", background: INK, border: `1px solid ${LINE}`, borderRadius: 20, color: MUTE }}>{f}</span>
                      ))}
                    </div>
                  )}
                  <p className="mono" style={{ fontSize: 11, color: "#5A564E", marginTop: 10, marginBottom: 0 }}>General context, not asset-specific certainty — always cross-check independently.</p>
                </div>
              )}

              {/* 4. Structure Analysis — trend + patterns/SMC events + support/resistance, grouped */}
              <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 20, marginBottom: 14 }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: 1.5, color: GOLD, marginBottom: 14, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <Grid3x3 size={12} /> Structure analysis
                </div>

                {sa.trend && (
                  <p className="mono" style={{ fontSize: 13.5, lineHeight: 1.6, color: TEXT, margin: "0 0 16px" }}>{sa.trend}</p>
                )}

                {sa.events?.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
                    {sa.events.map((ev, i) => (
                      <div key={i} style={{ background: INK, border: `1px solid ${LINE}`, borderRadius: 6, padding: "11px 13px", display: "flex", gap: 10 }}>
                        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, letterSpacing: 0.5, whiteSpace: "nowrap", paddingTop: 1 }}>{ev.name}</span>
                        <span className="mono" style={{ fontSize: 12, color: MUTE, lineHeight: 1.5 }}>{ev.explanation}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1.2, color: GREEN, marginBottom: 8, textTransform: "uppercase" }}>Support</div>
                    {(sa.support || []).map((lvl, i) => (<div key={i} className="mono" style={{ fontSize: 13, color: TEXT, padding: "3px 0" }}>{lvl}</div>))}
                    {(!sa.support || sa.support.length === 0) && <div className="mono" style={{ fontSize: 12, color: "#5A564E" }}>—</div>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="mono" style={{ fontSize: 10.5, letterSpacing: 1.2, color: RED, marginBottom: 8, textTransform: "uppercase" }}>Resistance</div>
                    {(sa.resistance || []).map((lvl, i) => (<div key={i} className="mono" style={{ fontSize: 13, color: TEXT, padding: "3px 0" }}>{lvl}</div>))}
                    {(!sa.resistance || sa.resistance.length === 0) && <div className="mono" style={{ fontSize: 12, color: "#5A564E" }}>—</div>}
                  </div>
                </div>
              </div>

              {/* 5. Strategy */}
              {result.strategy && (
                <div style={{ marginBottom: 14, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 20 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: 1.5, color: GOLD, marginBottom: 10, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}><Layers size={12} /> Possible approach</div>
                  <p className="mono" style={{ fontSize: 13.5, lineHeight: 1.65, color: TEXT, margin: 0 }}>{result.strategy}</p>
                </div>
              )}

              {/* 6. Timeframe context */}
              {result.timeframeContext && (
                <div style={{ marginBottom: 20, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 20 }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: 1.5, color: GOLD, marginBottom: 10, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}><Clock size={12} /> Timeframe context</div>
                  <p className="mono" style={{ fontSize: 13.5, lineHeight: 1.65, color: TEXT, margin: 0 }}>{result.timeframeContext}</p>
                </div>
              )}

              {/* Disclaimer */}
              <div className="mono" style={{ display: "flex", gap: 10, padding: 15, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12, color: MUTE, lineHeight: 1.6 }}>
                <AlertTriangle size={15} color={MUTE} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Automated reading of visual patterns (and general market context, when enabled) — not personalized financial advice, and not an instruction to trade. Levels shown are indicative and guarantee no outcome. Trading carries real risk of capital loss.</span>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button
                  onClick={() => saveToHistory(result, image)}
                  disabled={savingToHistory || savedToHistory}
                  className="btn mono"
                  style={{
                    flex: 1, padding: 13, borderRadius: 5, fontSize: 13, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    background: savedToHistory ? GREEN + "14" : `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`,
                    border: savedToHistory ? `1px solid ${GREEN}44` : "none",
                    color: savedToHistory ? GREEN : INK,
                  }}
                >
                  {savingToHistory ? (
                    <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
                  ) : savedToHistory ? (
                    <><Clock size={14} /> Saved</>
                  ) : (
                    <><Clock size={14} /> Save</>
                  )}
                </button>

                <button
                  onClick={() => handleShare(result, image)}
                  disabled={generatingShare}
                  className="btn mono"
                  style={{
                    flex: 1, padding: 13, borderRadius: 5, fontSize: 13, fontWeight: 600,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    background: PANEL, border: `1px solid ${LINE}`, color: TEXT,
                  }}
                >
                  {generatingShare ? (
                    <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Preparing…</>
                  ) : (
                    <><Share2 size={14} color={GOLD} /> Share result</>
                  )}
                </button>
              </div>

              <button onClick={reset} className="btn mono" style={{ marginTop: 10, width: "100%", padding: 12, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 5, color: MUTE, fontSize: 13 }}>
                Analyze another chart
              </button>
            </div>
          );
        })()}

        {/* Share modal */}
        {showShareModal && shareImageUrl && (
          <div
            className="fade"
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 50,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24,
            }}
          >
            <button
              onClick={() => setShowShareModal(false)}
              className="btn"
              style={{ position: "absolute", top: 20, right: 20, background: PANEL, border: `1px solid ${LINE}`, borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", color: TEXT }}
            >
              <X size={16} />
            </button>
            <img src={shareImageUrl} alt="Shareable analysis card" style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 12, border: `1px solid ${LINE}` }} />
            <p className="mono" style={{ color: MUTE, fontSize: 11.5, marginTop: 14, textAlign: "center", lineHeight: 1.5 }}>
              Tap and hold the image to save, or use the buttons below.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16, width: "100%", maxWidth: 360 }}>
              <button onClick={shareNatively} className="btn mono" style={{ flex: 1, padding: 12, borderRadius: 6, background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD})`, color: INK, border: "none", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <Share2 size={14} /> Share
              </button>
              <a
                href={shareImageUrl}
                download="smart-trade-analysis.png"
                className="btn mono"
                style={{ flex: 1, padding: 12, borderRadius: 6, background: PANEL, border: `1px solid ${LINE}`, color: TEXT, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, textDecoration: "none" }}
              >
                <Download size={14} color={GOLD} /> Download
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

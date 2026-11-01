// Serverless proxy: the browser never sees the real Anthropic API key.
//
// Every request must carry a valid Supabase session token
// (Authorization: Bearer <token>). On top of that, this proxy decides
// SERVER-SIDE who is allowed to spend Anthropic credit:
//
//   1. Paying users (subscriptions.status = 'active')  -> request passes through.
//   2. Everyone else gets exactly ONE free chart analysis per person:
//        - the email must be confirmed,
//        - the request must look like a plain image analysis (one user
//          message with an image, no tools / web search, capped tokens,
//          whitelisted model) so the free credit can't be used for the
//          news digest or as a free general-purpose Claude API,
//        - the credit is consumed atomically BEFORE calling Anthropic
//          (unique key in the free_analyses table), and refunded if
//          Anthropic fails, so a technical error never burns the credit.
//   3. Anything else -> 403 with a clear error code the app understands.
//
// Needs the env vars ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY
// (the latter is already set for the Stripe webhook).

const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wyimfexEpC5t2Ivva3wL1w_sF6W-YT2";

const FREE_ALLOWED_MODELS = ["claude-sonnet-4-6"];
const FREE_MAX_TOKENS = 1400;
const FREE_MAX_SYSTEM_CHARS = 8000;
const FREE_MAX_TEXT_CHARS = 400;

async function getSupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

async function hasActiveSubscription(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=plan&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) throw new Error(`subscription_check_failed_${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// Collapses the usual alias tricks so one person can't mint many accounts:
// name+anything@gmail.com and n.a.m.e@gmail.com all count as name@gmail.com.
function normalizeEmail(email) {
  const [localRaw, domainRaw] = String(email || "").toLowerCase().trim().split("@");
  if (!localRaw || !domainRaw) return String(email || "").toLowerCase();
  let local = localRaw.split("+")[0];
  let domain = domainRaw;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

// Returns true if the credit was just consumed, false if it was already used.
async function consumeFreeCredit(userId, emailNorm) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/free_analyses`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ user_id: userId, email_norm: emailNorm }),
  });
  if (res.ok) return true;
  if (res.status === 409) return false; // unique violation: this user or this normalized email already used it
  const text = await res.text().catch(() => "");
  throw new Error(`free_credit_error_${res.status}:${text.slice(0, 160)}`);
}

async function refundFreeCredit(userId) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/free_analyses?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
    });
  } catch (err) {
    console.error("Free credit refund failed:", err);
  }
}

// A free request must be a plain single-image analysis.
function validateFreeRequest(body) {
  if (!body || typeof body !== "object") return "bad_body";
  if (body.tools || body.tool_choice || body.stream) return "tools_not_allowed";
  if (!FREE_ALLOWED_MODELS.includes(body.model)) return "model_not_allowed";
  if (!(body.max_tokens > 0) || body.max_tokens > FREE_MAX_TOKENS) return "max_tokens_too_high";
  if (typeof body.system !== "string" || body.system.length > FREE_MAX_SYSTEM_CHARS) return "system_not_allowed";
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length !== 1 || msgs[0].role !== "user") return "messages_not_allowed";
  const content = msgs[0].content;
  if (!Array.isArray(content)) return "content_not_allowed";
  const images = content.filter((b) => b?.type === "image");
  const texts = content.filter((b) => b?.type === "text");
  if (images.length !== 1 || images.length + texts.length !== content.length) return "content_not_allowed";
  if (images[0].source?.type !== "base64") return "image_not_allowed";
  if (texts.some((t) => String(t.text || "").length > FREE_MAX_TEXT_CHARS)) return "text_too_long";
  return null;
}

// A read that comes back with confidence 0 means "this isn't a usable chart"
// (see the system prompt). The person shouldn't lose their free read over
// a bad screenshot, so the credit is given back and they can retry.
function isUnusableRead(data) {
  try {
    const text = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a === -1 || b <= a) return true; // no readable JSON at all
    const parsed = JSON.parse(text.slice(a, b + 1));
    return Number(parsed.confidence) === 0;
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const user = await getSupabaseUser(token);
  if (!user?.id) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY." });
    return;
  }

  let paying;
  try {
    paying = await hasActiveSubscription(user.id);
  } catch (err) {
    console.error("Entitlement check failed:", err);
    res.status(503).json({ error: "Couldn't verify your plan. Please try again." });
    return;
  }

  let usedFreeCredit = false;
  if (!paying) {
    if (!user.email_confirmed_at && !user.confirmed_at) {
      res.status(403).json({ error: "email_not_confirmed" });
      return;
    }
    const problem = validateFreeRequest(req.body);
    if (problem) {
      res.status(403).json({ error: "no_active_plan", detail: problem });
      return;
    }
    try {
      const ok = await consumeFreeCredit(user.id, normalizeEmail(user.email));
      if (!ok) {
        res.status(403).json({ error: "free_used" });
        return;
      }
      usedFreeCredit = true;
    } catch (err) {
      console.error("Free credit error:", err);
      res.status(503).json({ error: "Couldn't verify your free analysis. Please try again." });
      return;
    }
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({ error: "bad_upstream_response" }));
    if (usedFreeCredit && (!response.ok || isUnusableRead(data))) await refundFreeCredit(user.id);
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Anthropic proxy error:", err);
    if (usedFreeCredit) await refundFreeCredit(user.id);
    res.status(500).json({ error: String(err.message || err) });
  }
}

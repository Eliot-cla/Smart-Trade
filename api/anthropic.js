// Serverless proxy: the browser never sees the real Anthropic API key.
// It sends the exact same request body (model, system, messages, tools)
// that the client already builds, and this function attaches the key
// server-side before forwarding it to Anthropic.
//
// IMPORTANT: every request must carry a valid Supabase session token
// (Authorization: Bearer <token>). Without this check, anyone who found
// this URL could call it directly — with no account, no rate limiting,
// nothing — and quietly drain the Anthropic credit balance. We verify
// the token against Supabase itself on every request before doing
// anything else.

const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wyimfexEpC5t2Ivva3wL1w_sF6W-YT2";

async function verifySupabaseSession(accessToken) {
  if (!accessToken) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const isValidUser = await verifySupabaseSession(token);
  if (!isValidUser) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Set it in your hosting provider's environment variables." });
    return;
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

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Anthropic proxy error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
}

// Creates a Stripe Checkout Session for the signed-in user and returns
// its URL. The browser is then redirected to Stripe's own hosted page —
// we never touch card details ourselves.

const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wyimfexEpC5t2Ivva3wL1w_sF6W-YT2";

async function verifySupabaseSession(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { id, email, ... }
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const user = await verifySupabaseSession(token);
  if (!user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  const { priceId } = req.body || {};
  if (!priceId) {
    res.status(400).json({ error: "Missing priceId." });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ error: "Server is missing STRIPE_SECRET_KEY." });
    return;
  }

  // Packs are one-time; the Unlimited plans are subscriptions. Ask
  // Stripe which this price is rather than hardcoding a list here.
  let mode = "subscription";
  try {
    const priceRes = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const price = await priceRes.json();
    if (price?.type === "one_time") mode = "payment";
  } catch (err) {
    console.warn("Couldn't fetch price details, defaulting to subscription mode:", err);
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const params = new URLSearchParams({
    mode,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[user_id]": user.id,
  });
  if (mode === "subscription") {
    params.append("subscription_data[metadata][user_id]", user.id);
  }

  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error("Stripe checkout session error:", session);
      res.status(stripeRes.status).json({ error: session.error?.message || "Stripe error" });
      return;
    }
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout session creation failed:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
}

// Sends the signed-in user to Stripe's own hosted billing portal, where
// they can update their card, change or cancel a plan, and see invoices
// — without us having to build any of that ourselves.

const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wyimfexEpC5t2Ivva3wL1w_sF6W-YT2";

async function verifySupabaseSession(accessToken) {
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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !serviceKey) {
    res.status(500).json({ error: "Server misconfigured." });
    return;
  }

  try {
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=stripe_customer_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = await subRes.json();
    const customerId = rows?.[0]?.stripe_customer_id;
    if (!customerId) {
      res.status(400).json({ error: "No billing account found yet — subscribe to a plan first." });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const params = new URLSearchParams({ customer: customerId, return_url: `${origin}/` });
    const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const portal = await portalRes.json();
    if (!portalRes.ok) {
      res.status(portalRes.status).json({ error: portal.error?.message || "Stripe error" });
      return;
    }
    res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error("Portal session error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
}

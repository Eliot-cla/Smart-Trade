// Stripe calls this URL directly (never the browser) whenever a payment
// or subscription changes state. We verify the signature ourselves with
// Node's built-in crypto module — no need to install the Stripe SDK just
// for this. This is the only place that writes to the `subscriptions`
// table, using the Supabase service role key since there's no user JWT
// in a server-to-server webhook call.

import crypto from "crypto";

export const config = {
  api: { bodyParser: false }, // we need the exact raw bytes to verify the signature
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const SUPABASE_URL = "https://tnykozgghogoqhxvtekq.supabase.co";

async function upsertSubscription(row) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase upsert failed: ${res.status} ${text}`);
  }
}

// Maps a Stripe price to a plan label stored in Supabase. Update this if
// prices are ever archived/recreated (their IDs change every time).
function planFromPriceId(priceId) {
  const map = {
    price_1U7BZcAbZYjrqJ1RNDSVfcQz: "starter",
    price_1U7BaXAbZYjrqJ1RMynVBwr8: "growth",
    price_1U7B6gAbZYjrqJ1RGTA2ms4g: "unlimited_monthly",
    price_1U7BABAbZYjrqJ1RfEsxrngR: "unlimited_annual",
  };
  return map[priceId] || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = (await buffer(req)).toString("utf8");
  const sig = req.headers["stripe-signature"];

  if (!secret || !verifyStripeSignature(rawBody, sig, secret)) {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (userId) {
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription || null,
            // For one-time packs there's no ongoing subscription object,
            // so we label the plan directly from the price ID we stashed
            // in metadata at checkout — the customer.subscription.*
            // events below handle real subscriptions instead.
            plan: session.mode === "payment" ? planFromPriceId(session.metadata?.price_id) : "pending",
            status: "active",
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        if (userId) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            plan: planFromPriceId(priceId),
            status: sub.status,
            current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        if (userId) {
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            plan: "none",
            status: "canceled",
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      default:
        break; // ignore event types we don't act on
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
}

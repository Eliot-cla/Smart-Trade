# Smart Trade — deployment guide

This is the same app you've been testing inside Claude, packaged as a real
project you can put online. Two things needed fixing to work outside
Claude's sandbox:

1. **Supabase calls** — blocked inside the Claude artifact, works fine on
   a real host.
2. **Anthropic API calls** — inside Claude, the API key was injected for
   you automatically. On a real site, that doesn't happen, so a tiny
   serverless function (`api/anthropic.js`) now holds the real key
   server-side and forwards requests. The app already points to it.

## 1. Get an Anthropic API key

- Go to https://console.anthropic.com
- Create an API key (this is different from your claude.ai login — it's
  for programmatic access, and it's billed separately, pay-as-you-go)
- Keep it somewhere safe for step 3 below. **Never put it directly in the
  code or commit it to GitHub.**

## 2. Push this project to GitHub

- Create a new (private is fine) GitHub repository
- Upload all the files in this folder to it (drag-and-drop works on
  github.com if you don't want to use git commands)

## 3. Deploy on Vercel (free)

- Go to https://vercel.com, sign up (GitHub login is easiest)
- Click "Add New Project", pick the repository you just created
- Before clicking Deploy, open **Environment Variables** and add:
  - Name: `ANTHROPIC_API_KEY`
  - Value: the key from step 1
- Click Deploy. In about a minute you'll get a live URL like
  `smart-trade-yourname.vercel.app`

## 4. Test it for real

- Open the live URL
- Go through Welcome → Landing → Create account
- This time, account creation should work — Supabase isn't blocked
  anymore
- Analyze a chart, save it to Track Record, log out, log back in, and
  confirm the analysis is still there

## Notes

- The Supabase project URL and public/publishable key are already in the
  code (`src/App.jsx`, near the top) — that key is meant to be public,
  it's safe.
- If you ever change domains or add a custom domain, nothing else needs
  to change — Supabase and the Anthropic proxy don't care what domain
  calls them.
- Costs to expect: Anthropic API usage is pay-as-you-go (charged per
  analysis, generally a few cents each depending on volume). Supabase and
  Vercel both have generous free tiers that should cover early testing
  and a modest number of real users.

# Deployment Guide — IEOR Email Advising System

This document explains how to deploy the system so advisors can access it at a URL (no terminal required). The stack is:

| Layer | Service | Cost |
|-------|---------|------|
| Frontend | [Vercel](https://vercel.com) | Free |
| Backend API | [Render](https://render.com) | Free (spins down after 15 min idle; first request after idle takes ~30 sec) |
| Database | [Neon](https://neon.tech) | Free forever |

---

## Prerequisites

- GitHub account with access to the repo
- Accounts on Vercel, Render, and Neon (all free — sign up with GitHub)
- Your OpenAI API key
- Your Google OAuth client secrets file (from Google Cloud Console)

---

## Step 1 — Set up the database (Neon)

1. Go to [neon.tech](https://neon.tech) → **Create a project** → name it `ieor-email-advising`
2. Copy the **Connection string** (looks like `postgresql://user:password@host/dbname`)
3. Save it — you'll need it in Step 3

---

## Step 2 — Deploy the backend (Render)

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo (`IEOR-Email-Advising`)
3. Render will detect `render.yaml` automatically — accept the settings
4. Under **Environment Variables**, add:

   | Key | Value |
   |-----|-------|
   | `OPENAI_API_KEY` | Your OpenAI key |
   | `DATABASE_URL` | The Neon connection string from Step 1 |
   | `FRONTEND_URL` | Leave blank for now — fill in after Step 3 |

5. Click **Deploy**. First build takes ~5 minutes (downloading ML models).
6. Once deployed, copy your backend URL (e.g., `https://ieor-email-advising-api.onrender.com`)

---

## Step 3 — Deploy the frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import from GitHub
2. Select the `IEOR-Email-Advising` repo
3. Set **Root Directory** to `Frontend`
4. Under **Environment Variables**, add:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_BACKEND_URL` | Your Render backend URL from Step 2 |

5. Click **Deploy**. Takes ~2 minutes.
6. Copy your frontend URL (e.g., `https://ieor-advising.vercel.app`)

---

## Step 4 — Link them together

1. Go back to **Render → Your backend service → Environment**
2. Set `FRONTEND_URL` to your Vercel URL from Step 3
3. Click **Save** — Render will redeploy automatically

---

## Step 5 — Connect Gmail

This step is done once per Google account and then persists in the database.

1. Open the deployed frontend URL in a browser
2. Go to **Settings → Gmail Integration**
3. You need your `google_client_secrets.json` file from Google Cloud Console.
   - In Google Cloud Console, add your Render backend URL as an authorized redirect URI:
     `https://your-backend.onrender.com/gmail/callback`
   - Download the secrets file and place it at `Backend/data/google_client_secrets.json`
   - Redeploy the backend (push any small change to trigger it, or redeploy manually in Render)
4. Click **Connect Gmail** in the Settings tab and complete the OAuth flow

---

## Ongoing maintenance

- **Code updates**: Push to the `main` branch on GitHub. Vercel and Render both auto-deploy on push.
- **Knowledge base edits**: Use the Settings tab in the app. Changes save to the database and persist across deploys.
- **Gmail re-authentication**: If the OAuth token expires, go to Settings → Gmail Integration → Disconnect → Reconnect.
- **Service goes to sleep**: The Render free tier spins down after 15 minutes of no traffic. The first advisor request after idle will take ~30 seconds while it wakes up. Subsequent requests are fast.

---

## Environment variable reference

### Backend (set in Render dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI key for response generation |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `FRONTEND_URL` | Yes | Your Vercel URL (for CORS) |
| `GOOGLE_OAUTH_CLIENT_FILE` | No | Path to Google secrets file (default: `data/google_client_secrets.json`) |

### Frontend (set in Vercel dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_BACKEND_URL` | Yes | Your Render backend URL |

---

## Security notes

- Never commit `Backend/data/gmail_token.json` or `Backend/data/google_client_secrets.json` to git
- Never commit real API keys to `.env` — the `.env` file in this repo is a blank template only
- The `DATABASE_URL` contains credentials — set it only in the Render dashboard, never in code

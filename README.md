# Binance Alpha PND Live Radar

Live dashboard and Telegram alert worker for Binance Alpha + USDT-M perpetual signals.

## What it scans

- Always scans the seed pump cohort: `RIVER, SIREN, RAVE, SOON, POWER, MYX, ARIA`.
- Always scans the seed candidate list: `IRYS, XAN, ON, Q, TA, IDOL, TUT, GWEI, TAC, TAG`.
- By default also scans active Binance Alpha tokens that pass a lightweight Alpha prefilter. Tune with env vars.

## Deploy on Vercel

1. Push this `live-radar` folder to GitHub.
2. Create a Vercel project and set the project root directory to `live-radar`.
3. Add environment variables:

| Name | Required | Example |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes for alerts | `123456:ABC...` |
| `TELEGRAM_CHAT_ID` | yes for alerts | `123456789` or `@channelname` |
| `CRON_SECRET` | recommended | random 32+ char string |
| `PUBLIC_BASE_URL` | recommended | `your-project.vercel.app` |
| `SCAN_ALPHA_UNIVERSE` | optional | `true` |
| `MAX_SCAN_TOKENS` | optional | `90` |
| `ALERT_SCORE_THRESHOLD` | optional | `75` |
| `ALERT_COOLDOWN_SECONDS` | optional | `21600` |
| `EXTRA_TOKENS` | optional | `TOKEN1,TOKEN2` |
| `UPSTASH_REDIS_REST_URL` | recommended | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | recommended | Upstash REST token |

4. Deploy. Vercel cron calls `/api/cron` every 5 minutes.

## Telegram setup

1. Create a bot with BotFather and copy its token.
2. Send any message to the bot.
3. Open `https://api.telegram.org/bot<token>/getUpdates` and copy your `chat.id`.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Vercel.

For a channel, add the bot as admin and use `@channelname` as `TELEGRAM_CHAT_ID`.

## Local checks

```powershell
npm run check
```

The dashboard auto-refreshes `/api/live` every 60 seconds. The alert worker only sends candidate signals; the historical pump cohort is kept for context.

## Free deploy with GitHub Pages + Actions

If Render asks for a paid plan, use the free static mode. It does not need an always-on backend.

How it works:

- GitHub Actions runs every 5 minutes.
- The workflow fetches Binance data and writes `public/data/live.json`.
- GitHub Pages serves the dashboard.
- The dashboard reads `data/live.json`.
- Telegram alerts are sent from the workflow.

Files:

- `.github/workflows/live-radar.yml`
- `scripts/build-static.js`
- `assets/app.js` with fallback from `api/live` to `data/live.json`

Setup:

1. In GitHub repo settings, open **Pages** and set source to **GitHub Actions** if GitHub asks.
2. Add repo secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. Add repo variables:
   - `PUBLIC_BASE_URL`: usually `https://yaht84.github.io/binance_alpha/`
   - `SCAN_ALPHA_UNIVERSE`: `true`
   - `MAX_SCAN_TOKENS`: `90`
   - `ALERT_SCORE_THRESHOLD`: `75`
   - `ALERT_COOLDOWN_SECONDS`: `21600`

You can also run the workflow manually from the **Actions** tab.

## Deploy on Render

This repo also includes `server.js`, `render.yaml`, and `npm start` so it can run as a Render Node web service.

1. Push this folder to GitHub.
2. In Render, create a Blueprint from the repo. Render will read `render.yaml`.
3. Fill the secret env vars Render asks for:
   - `PUBLIC_BASE_URL`: the final `*.onrender.com` host after web service creation.
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - optional but strongly recommended: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

The Render web service exposes:

- `/` dashboard
- `/api/live` live JSON scan
- `/api/cron` protected alert endpoint

The Render cron service runs `npm run cron` every 5 minutes.

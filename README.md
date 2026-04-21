# Binance Alpha PND Live Radar

Live dashboard and Telegram alert worker for Binance Alpha + USDT-M perpetual signals.

## What it scans

- Always scans the seed pump cohort: `RIVER, SIREN, RAVE, SOON, POWER, MYX, ARIA`.
- Always scans the seed candidate list: `IRYS, XAN, ON, Q, TA, IDOL, TUT, GWEI, TAC, TAG`.
- By default also scans active Binance Alpha tokens that pass a lightweight Alpha prefilter. Tune with env vars.

## Deploy on Vercel

1. Push this `live-radar` folder to GitHub.
2. Import `yaht84/binance_alpha` in Vercel.
3. Add environment variables:

| Name | Required | Example |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes for alerts | `123456:ABC...` |
| `TELEGRAM_CHAT_ID` | yes for alerts | `123456789` or `@channelname` |
| `CRON_SECRET` | recommended | random 32+ char string |
| `PUBLIC_BASE_URL` | recommended | `your-project.vercel.app` |
| `SCAN_ALPHA_UNIVERSE` | optional | `true` |
| `DISABLE_FUTURES` | optional | `false` |
| `MAX_SCAN_TOKENS` | optional | `90` |
| `ALERT_SCORE_THRESHOLD` | optional | `75` |
| `ALERT_RESET_THRESHOLD` | optional | `60` |
| `ALERT_ESCALATION_DELTA` | optional | `12` |
| `ALERT_REMINDER_HOURS` | optional | `0` |
| `ALERT_COOLDOWN_SECONDS` | optional | `21600` |
| `EXTRA_TOKENS` | optional | `TOKEN1,TOKEN2` |
| `UPSTASH_REDIS_REST_URL` | required for alerts | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | required for alerts | Upstash REST token |

4. Deploy. The project is pinned to Vercel region `fra1` in `vercel.json`.

Important for free Vercel Hobby:

- Vercel Cron on Hobby is limited to once per day, so this repo does not register a 5-minute Vercel cron by default.
- The live dashboard still works because it calls `/api/live` from the browser.
- For Telegram alert checks every 5 minutes, use an external free scheduler such as cron-job.org to call:

```text
https://YOUR-PROJECT.vercel.app/api/cron?secret=YOUR_CRON_SECRET
```

Set `CRON_SECRET` in Vercel first. Alert delivery is stateful: `/api/cron` only sends a message when a candidate enters a trigger, escalates by `ALERT_ESCALATION_DELTA`, or optional reminders are enabled. It will not send the same active signal every 5 minutes.

Upstash Redis is required for Telegram alerts on Vercel. Without it, `/api/cron` refuses to send alerts because Vercel serverless memory is not durable enough to prevent spam.

After deploy, check:

- `/api/health` should show `regionHint: "fra1"` and `withFutures > 0`.
- `/api/live` should return the full scan JSON.

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

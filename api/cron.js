const { getConfig } = require("./_lib/config");
const { runScan } = require("./_lib/scanner");
const { formatAlert, sendTelegram } = require("./_lib/telegram");
const { markSeen, seen } = require("./_lib/store");

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const config = getConfig();
    const scan = await runScan(config);
    const signals = scan.records.filter((item) => item.signal && item.cohort !== "pumped");
    const sent = [];
    const skipped = [];

    for (const item of signals) {
      const key = `telegram:${item.signalKey}`;
      if (await seen(key)) {
        skipped.push({ token: item.token, reason: "cooldown" });
        continue;
      }
      const message = formatAlert(item, config.publicBaseUrl);
      const result = await sendTelegram(message);
      if (result.skipped) {
        skipped.push({ token: item.token, reason: result.reason });
        continue;
      }
      await markSeen(key, config.alertCooldownSeconds);
      sent.push({ token: item.token, score: item.score });
    }

    res.status(200).json({
      ok: true,
      generatedAt: scan.generatedAt,
      signalCount: signals.length,
      sent,
      skipped,
      top: scan.summary.top.slice(0, 5).map((item) => ({
        token: item.token,
        score: item.score,
        reasons: item.reasons.slice(0, 3),
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: "cron_failed",
      message: error.message,
    });
  }
};

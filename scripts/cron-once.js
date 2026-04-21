const { getConfig } = require("../api/_lib/config");
const { runScan } = require("../api/_lib/scanner");
const { formatAlert, sendTelegram } = require("../api/_lib/telegram");
const { markSeen, seen } = require("../api/_lib/store");

async function main() {
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
    const result = await sendTelegram(formatAlert(item, config.publicBaseUrl));
    if (result.skipped) {
      skipped.push({ token: item.token, reason: result.reason });
      continue;
    }
    await markSeen(key, config.alertCooldownSeconds);
    sent.push({ token: item.token, score: item.score });
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: scan.generatedAt,
        signalCount: signals.length,
        sent,
        skipped,
        top: scan.summary.top.slice(0, 5).map((item) => ({
          token: item.token,
          score: item.score,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

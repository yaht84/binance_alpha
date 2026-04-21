const { getConfig } = require("../api/_lib/config");
const { runScan } = require("../api/_lib/scanner");
const { processAlertScan } = require("../api/_lib/alert-engine");

async function main() {
  const config = getConfig();
  const scan = await runScan(config);
  const signals = scan.records.filter((item) => item.signal && item.cohort !== "pumped");
  const alerts = await processAlertScan(scan, config);

  console.log(
    JSON.stringify(
      {
        generatedAt: scan.generatedAt,
        signalCount: signals.length,
        sent: alerts.sent,
        skipped: alerts.skipped,
        stateUpdated: alerts.updated.length,
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

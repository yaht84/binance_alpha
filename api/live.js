const { runScan } = require("./_lib/scanner");

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const fast = url.searchParams.get("fast") !== "0";
    const payload = await runScan({
      maxScanTokens: fast ? Number(process.env.MAX_SCAN_TOKENS || 90) : Number(process.env.MAX_FULL_SCAN_TOKENS || 140),
    });
    res.setHeader("cache-control", "s-maxage=45, stale-while-revalidate=90");
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: "live_scan_failed",
      message: error.message,
    });
  }
};

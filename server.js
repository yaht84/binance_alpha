const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { runScan } = require("./api/_lib/scanner");
const { getConfig } = require("./api/_lib/config");
const { processAlertScan } = require("./api/_lib/alert-engine");

const root = __dirname;
const port = Number(process.env.PORT || 10000);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function authorized(req, url) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

async function runAlertScan() {
  const config = getConfig();
  const scan = await runScan(config);
  const signals = scan.records.filter((item) => item.signal && item.cohort !== "pumped");
  const alerts = await processAlertScan(scan, config);

  return {
    ok: true,
    generatedAt: scan.generatedAt,
    signalCount: signals.length,
    sent: alerts.sent,
    skipped: alerts.skipped,
    stateUpdated: alerts.updated.length,
    top: scan.summary.top.slice(0, 5).map((item) => ({
      token: item.token,
      score: item.score,
      reasons: item.reasons.slice(0, 3),
    })),
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/live") {
    const payload = await runScan();
    sendJson(res, 200, payload);
    return;
  }

  if (url.pathname === "/api/cron") {
    if (!authorized(req, url)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    sendJson(res, 200, await runAlertScan());
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(file),
      "cache-control": requested.startsWith("/assets/") ? "public, max-age=300" : "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      sendJson(res, 500, { error: "server_error", message: error.message });
    });
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Binance Alpha PND radar listening on 0.0.0.0:${port}`);
});

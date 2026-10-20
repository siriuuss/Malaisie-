// Dev helper: render arbitrary timeline moments or free camera views to PNG.
// Usage: node tools/debug-view.mjs <outDir> <views.json> [scale]
//   views.json: [{ "name": "x", "t": 18, "pos": [x,y,z]?, "target": [x,y,z]?, "fov": 50? }]
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"); // e.g. the global install
const [outDir, viewsFile, scaleArg] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const views = JSON.parse(fs.readFileSync(viewsFile, "utf8"));
const scale = Number(scaleArg ?? 0.5);
fs.mkdirSync(outDir, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" }).end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("already non-indexed")) console.log("[page]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const flags = JSON.parse(process.env.FLAGS ?? "{}");
await page.addInitScript(([s, flags]) => {
  window.__malaisieFlags = flags;
  window.__timelines = {};
  window.__hyperframes = { getVariables: () => ({ renderScale: s }) };
}, [scale, flags]);
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.__malaisieDebug, null, { timeout: 600000 });
for (const v of views) {
  const t0 = Date.now();
  await page.evaluate((v) => {
    const d = window.__malaisieDebug;
    d.setOverride(
      v.pos
        ? (cam) => {
            cam.position.set(...v.pos);
            cam.up.set(0, 1, 0);
            cam.lookAt(...v.target);
            if (v.fov) cam.fov = v.fov;
            cam.near = v.near ?? 0.5;
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld();
          }
        : null,
    );
    d.renderAt(v.t);
  }, v);
  const url = await page.evaluate(() => document.getElementById("three-layer").toDataURL("image/png"));
  fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(url.split(",")[1], "base64"));
  console.log(v.name, `${Date.now() - t0} ms`);
}
await browser.close();
server.close();

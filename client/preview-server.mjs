import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT || 4173);
const host = "0.0.0.0";

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".map", "application/json; charset=utf-8"],
]);

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

const isPathInsideRoot = (resolvedPath) => {
  const rel = path.relative(rootDir, resolvedPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
  console.log(`[REQ] ${req.method} ${req.url} -> ${reqPath}`);
  const requested = reqPath === "/" ? "/index.html" : reqPath;
  let filePath = path.resolve(rootDir, `.${requested}`);

  if (reqPath === "/log" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      console.log(`[CLIENT-LOG] ${body}`);
      send(res, 200, "OK");
    });
    return;
  }

  if (!isPathInsideRoot(filePath)) {
    send(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(rootDir, "index.html");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = mime.get(ext) || "application/octet-stream";
    const baseName = path.basename(filePath);
    const noStore = true;
    const cacheControl = noStore
      ? "no-store, no-cache, must-revalidate, proxy-revalidate"
      : "public, max-age=31536000, immutable";

    send(res, 200, data, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      Pragma: "no-cache",
      Expires: "0",
    });
  });
});

server.listen(port, host, () => {
  console.log(`[client] serving ${rootDir} on http://${host}:${port}`);
});

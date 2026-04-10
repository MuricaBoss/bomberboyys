import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "dist");
const buildMetaPath = path.resolve(process.cwd(), "src/build-meta.ts");
const buildMetaSource = fs.existsSync(buildMetaPath)
  ? fs.readFileSync(buildMetaPath, "utf8")
  : "";
const buildNumberMatch = buildMetaSource.match(/DISPLAY_BUILD_NUMBER\s*=\s*(?:"|')?(\d+)(?:"|')?/);
const buildNumber = buildNumberMatch ? Number(buildNumberMatch[1]) : 0;
const version = {
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  builtAt: new Date().toISOString(),
  buildNumber,
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, "version.json"),
  `${JSON.stringify(version, null, 2)}\n`,
  "utf8"
);

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const projectParent = path.resolve(repoRoot, "..");
const snapshotRoot = path.resolve(repoRoot, "..", "..", "_snapshots");
const buildMetaPath = path.join(repoRoot, "client", "src", "build-meta.ts");

const buildMetaSource = fs.readFileSync(buildMetaPath, "utf8");
const buildNumberMatch = buildMetaSource.match(/DISPLAY_BUILD_NUMBER\s*=\s*(\d+)/);
if (!buildNumberMatch) {
  throw new Error(`Failed to read build number from ${buildMetaPath}`);
}
const buildNumber = Number(buildNumberMatch[1]);

const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

fs.mkdirSync(snapshotRoot, { recursive: true });

const archiveBaseName = `bomber-boys-build-${buildNumber}-${timestamp}.tar.gz`;
const archivePath = path.join(snapshotRoot, archiveBaseName);
const checksumPath = `${archivePath}.sha256`;

const tarResult = spawnSync(
  "tar",
  [
    "-czf",
    archivePath,
    "--exclude=bomber-boys/client/node_modules",
    "--exclude=bomber-boys/server/node_modules",
    "--exclude=bomber-boys/client/dist",
    "--exclude=bomber-boys/.git",
    "--exclude=.DS_Store",
    "bomber-boys",
  ],
  {
    cwd: projectParent,
    stdio: "inherit",
  },
);

if (tarResult.status !== 0) {
  process.exit(tarResult.status ?? 1);
}

const archiveBuffer = fs.readFileSync(archivePath);
const checksum = crypto.createHash("sha256").update(archiveBuffer).digest("hex");
fs.writeFileSync(checksumPath, `${checksum}  ${archivePath}\n`, "utf8");

console.log(archivePath);

import { Client } from "colyseus.js";

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
export const wsEndpoint = `${wsProtocol}://${location.hostname}:2567`;
const httpProtocol = location.protocol === "https:" ? "https" : "http";
export const httpEndpoint = `${httpProtocol}://${location.hostname}:2567`;
export const client = new Client(wsEndpoint);

const VERSION_POLL_MS = 15000;
export let activeClientBuildId = "";
let versionPollTimer = 0;
const ENABLE_VERSION_POLLING = false;

export const CLIENT_BUNDLE_VERSION = (() => {
  try {
    const fileName = new URL(import.meta.url).pathname.split("/").pop() || "";
    if (fileName.startsWith("index-") && fileName.endsWith(".js")) {
      return fileName.slice("index-".length, -".js".length);
    }
    return fileName || "dev";
  } catch {
    return "unknown";
  }
})();

async function fetchClientBuildId() {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return "";
  const data = await res.json() as { id?: string };
  return String(data?.id || "");
}

async function pollClientVersion() {
  try {
    const nextId = await fetchClientBuildId();
    if (!nextId) return;
    if (!activeClientBuildId) {
      activeClientBuildId = nextId;
      return;
    }
    if (nextId !== activeClientBuildId) {
      window.location.reload();
    }
  } catch {
    // Ignore transient network errors.
  }
}

export function startClientVersionPolling() {
  if (!ENABLE_VERSION_POLLING) return;
  if (versionPollTimer) return;
  void pollClientVersion();
  versionPollTimer = window.setInterval(() => {
    void pollClientVersion();
  }, VERSION_POLL_MS);
}

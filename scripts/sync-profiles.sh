#!/bin/bash

# Configuration
SERVER_IP="46.224.175.9"
REMOTE_PATH="/opt/bomber-boys/server/profiles/"
LOCAL_PATH="/Volumes/munapelilevy/_AntiGravity/Projektit/bomber-boys/lataukset/"

echo "[Sync] Pulling telemetry profiles from ${SERVER_IP}..."

# Ensure local dir exists
mkdir -p "${LOCAL_PATH}"

# Sync files
rsync -avz --progress "root@${SERVER_IP}:${REMOTE_PATH}" "${LOCAL_PATH}"

echo "[Sync] Done. Files are available in ${LOCAL_PATH}"

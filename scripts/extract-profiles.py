import json
import os
import hashlib

logs_file = "/Volumes/munapelilevy/_AntiGravity/Projektit/bomber-boys/lataukset/current_logs.txt"
output_dir = "/Volumes/munapelilevy/_AntiGravity/Projektit/bomber-boys/lataukset"

if not os.path.exists(logs_file):
    print(f"File not found: {logs_file}")
    exit(1)

seen_hashes = set()
count = 0

with open(logs_file, 'r') as f:
    for line in f:
        if "[Telemetry] Received profile report:" in line:
            try:
                json_str = line.split("[Telemetry] Received profile report:")[1].strip()
                data = json.loads(json_str)
                
                # Deduplicate by hashing the whole JSON string
                line_hash = hashlib.md5(json_str.encode()).hexdigest()
                if line_hash in seen_hashes:
                    continue
                seen_hashes.add(line_hash)
                
                # Generate unique filename
                build = data.get("buildNumber", "unknown")
                session = data.get("sessionId", "unknown")
                timestamp = data.get("timestamp", "unknown").replace(":", "-").replace(".", "-")
                
                filename = f"profile-build-{build}-{session}-{timestamp}.json"
                filepath = os.path.join(output_dir, filename)
                
                with open(filepath, 'w') as out:
                    json.dump(data, out, indent=2)
                
                count += 1
            except Exception as e:
                # print(f"Error parsing line: {e}")
                pass

print(f"Extracted {count} unique reports to {output_dir}")

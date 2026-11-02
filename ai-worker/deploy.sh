#!/usr/bin/env bash
# Deploys worker.js as Cloudflare Worker "ccc-ai" using env CLOUDFLARE_API_TOKEN.
# Secrets are read from env (GEMINI_API_KEY, optional GROQ_API_KEY) and never printed or written to files.
set -euo pipefail
cd "$(dirname "$0")"
API=https://api.cloudflare.com/client/v4
H=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
ACC=$(curl -sf "${H[@]}" $API/accounts | python3 -c "import sys,json;print(json.load(sys.stdin)['result'][0]['id'])")
S=$API/accounts/$ACC/workers/scripts/ccc-ai
curl -sf "${H[@]}" -X PUT "$S" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-10-01"};type=application/json' \
  -F 'worker.js=@worker.js;type=application/javascript+module' | python3 -c "import sys,json;print('upload', json.load(sys.stdin)['success'])"
put_secret() { python3 -c "import json,os;print(json.dumps({'name':'$1','text':os.environ['$1'],'type':'secret_text'}))" \
  | curl -sf "${H[@]}" -X PUT "$S/secrets" -H 'Content-Type: application/json' --data @- | python3 -c "import sys,json;print('secret $1', json.load(sys.stdin)['success'])"; }
put_secret GEMINI_API_KEY
[ -n "${GROQ_API_KEY:-}" ] && put_secret GROQ_API_KEY
[ -n "${ACCURACY_TEST_KEY:-}" ] && put_secret ACCURACY_TEST_KEY
curl -sf "${H[@]}" -X POST "$S/subdomain" -H 'Content-Type: application/json' --data '{"enabled":true}' | python3 -c "import sys,json;print('workers.dev', json.load(sys.stdin)['success'])"

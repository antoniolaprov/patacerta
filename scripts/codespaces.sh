#!/usr/bin/env bash
# Prepares PataCerta inside GitHub Codespaces (or any Linux box with Docker):
# creates .env, installs everything, starts Postgres/Redis/n8n and loads the demo data.
# Usage: bash scripts/codespaces.sh        (then: npm run dev)
set -euo pipefail
cd "$(dirname "$0")/.."

# Public addresses of each port in Codespaces (falls back to localhost elsewhere).
url() {
  if [ -n "${CODESPACE_NAME:-}" ]; then
    echo "https://${CODESPACE_NAME}-$1.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    echo "http://localhost:$1"
  fi
}

set_env() { # set_env KEY VALUE: replaces the line or appends it
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

echo "==> .env"
[ -f .env ] || cp .env.example .env
set_env LLM_PROVIDER openai
set_env CORS_ORIGINS "$(url 5173),$(url 4200),http://localhost:5173,http://localhost:4200"
set_env WEB_URL "$(url 5173)"
# The Groq key comes from a Codespaces secret named OPENAI_API_KEY (never from the repo).
if [ -n "${OPENAI_API_KEY:-}" ]; then
  set_env OPENAI_API_KEY "$OPENAI_API_KEY"
  echo "    chave do Groq: lida do segredo do Codespaces"
else
  echo "    AVISO: segredo OPENAI_API_KEY não encontrado; coloque a chave do Groq no .env"
fi

echo "==> dependências"
npm run install:all --silent

echo "==> Postgres, Redis e n8n"
docker compose up -d postgres redis n8n
until docker compose exec -T postgres pg_isready -U patacerta >/dev/null 2>&1; do sleep 2; done

echo "==> banco e dados de exemplo"
npm run db:setup --silent

echo "==> fluxos do n8n"
for i in $(seq 1 30); do
  docker compose exec -T n8n n8n import:workflow --separate --input=/workflows >/dev/null 2>&1 && break
  sleep 3
done

# The apps call the API and the AI service from the browser, so those ports must be public.
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null; then
  gh codespace ports visibility 3000:public 4000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 \
    && echo "==> portas 3000 e 4000 marcadas como públicas" || true
fi

cat <<EOF

Pronto. Agora rode:  npm run dev

Depois, na aba PORTAS (Ports), deixe as portas 3000 e 4000 como "Public"
(botão direito > Port Visibility > Public) e abra:
  Painel da clínica  $(url 4200)   (admin@patacerta.dev / patacerta123)
  App do tutor       $(url 5173)   (ana@patacerta.dev / patacerta123)
  n8n                $(url 5678)
EOF

#!/usr/bin/env python3
"""Gera unix/instalar.sh a partir de unix/instalar.mjs e das ferramentas em ../ferramentas (que ficam embutidas em base64).
Uso: python3 unix/montar.py   (rode na raiz do repositorio)"""
import base64, json, pathlib
raiz = pathlib.Path(__file__).resolve().parent.parent
mapa = {'codex_powerpack': 'codex-powerpack-mcp.cjs', 'node_repl': 'codex-node-repl-mcp.cjs', 'sequential_thinking': 'codex-sequential-thinking-mcp.cjs',
        'memory': 'codex-memory-mcp.cjs', 'context7': 'codex-context7-mcp.cjs'}
mcp = {k: base64.b64encode((raiz / 'ferramentas' / v).read_bytes()).decode() for k, v in mapa.items()}
js = (raiz / 'unix' / 'instalar.mjs').read_text(encoding='utf-8').replace('/*__MCP__*/{}', json.dumps(mcp))
assert 'NODE_FONTE' not in js
cab = '''#!/usr/bin/env bash
# Instalador Lauren API para Mac e Linux. Configura Codex, Claude Code e OpenCode para usarem a Lauren API.
# Uso:    curl -fsSL <URL>/instalar.sh | bash
# Desfazer: curl -fsSL <URL>/instalar.sh | bash -s -- --uninstall
# Opcoes: --yes (nao pergunta)  --targets=codex,claude-code,opencode  --endpoint=https://...   Chave: GATEWAY_API_KEY ou digitada na hora.
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado. Instale a versao 18 ou mais nova: https://nodejs.org (Mac: brew install node | Ubuntu/Debian: sudo apt install nodejs)" >&2; exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "[ERRO] Node.js $(node -v) e antigo. Precisa da versao 18 ou mais nova: https://nodejs.org" >&2; exit 1
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/instalar.mjs" <<'NODE_FONTE'
'''
(raiz / 'unix' / 'instalar.sh').write_text(cab + js + '\nNODE_FONTE\nnode "$TMP/instalar.mjs" "$@"\n', encoding='utf-8', newline='\n')
print('gerado: unix/instalar.sh')

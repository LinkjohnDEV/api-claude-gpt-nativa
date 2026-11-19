// Instalador Lauren API para Mac e Linux (v1.0.0). Configura Codex, Claude Code e OpenCode para usarem a Lauren API.
// Parte do trabalho do Gateway Setup v7.0 (Windows) e das correcoes da Lauren. Diferencas para o Windows:
//  - o config.toml do Codex e MESCLADO (mantem tudo o que voce ja tem; so comenta o que conflita e acrescenta o bloco da Lauren);
//  - sem as partes so do Windows (controle do computador, regra do sistema em ProgramData);
//  - nao mexe no historico de conversas do Codex.
// A chave NUNCA vai no arquivo: e pedida na hora (escondida) ou lida de GATEWAY_API_KEY.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const VERSAO = '1.0.0'
const ENDPOINT_PADRAO = 'https://api.ialauren.com'
const TAG = '# lauren-gw'                 // marca no fim das linhas que o instalador acrescenta
const OFF = '#lauren-off# '               // marca nas linhas suas que ele comentou (voltam ao desinstalar)
const INI = '# >>> lauren-gw >>>'; const FIM = '# <<< lauren-gw <<<'
const HOME = process.env.HOME || os.homedir()
const CODEX = process.env.CODEX_HOME || path.join(HOME, '.codex')
const CLAUDE = path.join(HOME, '.claude', 'settings.json')
const OPENCODE = path.join(HOME, '.config', 'opencode', 'opencode.json')
const BACKUPS = path.join(HOME, '.gateway', 'backups')
const ENVARQ = path.join(HOME, '.gateway', 'env')
const MCP_ARQUIVOS = { codex_powerpack: 'codex-powerpack-mcp.cjs', node_repl: 'codex-node-repl-mcp.cjs', sequential_thinking: 'codex-sequential-thinking-mcp.cjs', memory: 'codex-memory-mcp.cjs', context7: 'codex-context7-mcp.cjs' }
const MCP_B64 = /*__MCP__*/{}
const AGENTS = `# Lauren API: ferramentas disponiveis

Voce esta rodando pela Lauren API. Use as ferramentas disponiveis quando ajudarem a concluir a tarefa de ponta a ponta:
planejamento (update_plan), raciocinio em etapas (sequentialthinking), memoria (knowledge graph), documentacao (Context7),
busca na web, leitura e edicao de arquivos, REPL de Node e execucao de comandos. Peca confirmacao ao usuario antes de acoes destrutivas.
`

const out = (...a) => console.log(...a)
const args = process.argv.slice(2)
const flag = n => args.includes('--' + n)
const valor = n => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null }

// ---------- terminal (funciona com `curl | bash`: le do /dev/tty) ----------
let ttyFd = null
try { ttyFd = fs.openSync('/dev/tty', 'r+') } catch { ttyFd = null }
function lerLinha (pergunta, escondido) {
  if (ttyFd === null) throw new Error('Sem terminal para perguntar. Rode no Terminal, ou use --yes e GATEWAY_API_KEY.')
  fs.writeSync(ttyFd, pergunta)
  if (escondido) spawnSync('stty', ['-echo'], { stdio: [ttyFd, 'ignore', 'ignore'] })
  let s = ''; const b = Buffer.alloc(1)
  try { while (fs.readSync(ttyFd, b, 0, 1, null) > 0) { const c = b.toString(); if (c === '\n') break; if (c !== '\r') s += c } }
  finally { if (escondido) { spawnSync('stty', ['echo'], { stdio: [ttyFd, 'ignore', 'ignore'] }); fs.writeSync(ttyFd, '\n') } }
  return s
}

// ---------- arquivos ----------
const existe = p => { try { fs.accessSync(p); return true } catch { return false } }
const ler = p => fs.readFileSync(p, 'utf8')
function escrever (p, txt, modo = 0o600) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt, { mode: modo }); try { fs.chmodSync(p, modo) } catch {} }
const carimbo = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

// ---------- TOML: mesclar sem reescrever ----------
export function limparGerenciado (texto) {
  const linhas = texto.split(/\r?\n/); const saida = []; let dentro = false
  for (const l of linhas) {
    if (l.trim() === INI) { dentro = true; continue }
    if (l.trim() === FIM) { dentro = false; continue }
    if (dentro || l.endsWith(TAG)) continue
    saida.push(l.startsWith(OFF) ? l.slice(OFF.length) : l)
  }
  while (saida.length && saida[saida.length - 1] === '') saida.pop()
  return saida.join('\n') + '\n'
}
const CABECALHO = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/
const CHAVES_TOPO = ['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity', 'approval_policy', 'approvals_reviewer', 'sandbox_mode', 'web_search']
export function mesclarToml (original, { topo, mesclar = {}, substituir = [], acrescentar = [] }) {
  const base = limparGerenciado(original).split('\n'); if (base[base.length - 1] === '') base.pop()
  let ini = base.findIndex(l => CABECALHO.test(l)); if (ini < 0) ini = base.length
  let topoOrig = base.slice(0, ini).map(l => (CHAVES_TOPO.some(k => new RegExp('^\\s*' + k + '\\s*=').test(l)) ? OFF + l : l))
  let resto = base.slice(ini)
  // tabelas que a Lauren substitui por inteiro (e as sub-tabelas): comentadas, nunca apagadas
  const nomesSubst = new Set(substituir)
  let atual = null
  resto = resto.map(l => { const m = CABECALHO.exec(l); if (m) atual = m[1].replace(/\s+/g, ''); return atual && [...nomesSubst].some(n => atual === n || atual.startsWith(n + '.')) ? OFF + l : l })
  // tabelas que a Lauren mescla (so acrescenta/troca chaves): features, sandbox_workspace_write
  const novos = []
  for (const [tabela, chaves] of Object.entries(mesclar)) {
    const i = resto.findIndex(l => { const m = CABECALHO.exec(l); return m && m[1].replace(/\s+/g, '') === tabela })
    if (i < 0) { novos.push('', `[${tabela}] ${TAG}`, ...chaves.map(([k, v]) => `${k} = ${v} ${TAG}`)); continue }
    let fim = i + 1; while (fim < resto.length && !CABECALHO.test(resto[fim])) fim++
    for (const [k] of chaves) for (let j = i + 1; j < fim; j++) if (new RegExp('^\\s*' + k + '\\s*=').test(resto[j]) && !resto[j].endsWith(TAG)) resto[j] = OFF + resto[j]
    resto.splice(fim, 0, ...chaves.map(([k, v]) => `${k} = ${v} ${TAG}`)); 
  }
  const bloco = [INI, ...topo, FIM, '']
  const final = [...bloco, ...topoOrig, ...resto, ...novos, '', INI, ...acrescentar, FIM, '']
  return final.join('\n')
}

// ---------- catalogo de modelos do Codex ----------
function catalogoNativo () {
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lauren-cat-'))
    try {
      const bruto = execFileSync('codex', ['debug', 'models', '--bundled'], { env: { ...process.env, CODEX_HOME: tmp }, timeout: 12000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      const j = JSON.parse(bruto); return Array.isArray(j.models) ? j : null
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  } catch { return null }
}
const entradaPadrao = (slug, prio) => ({
  slug, display_name: slug, description: 'Lauren API', default_reasoning_level: 'high',
  supported_reasoning_levels: [{ effort: 'low', description: 'Low' }, { effort: 'medium', description: 'Medium' }, { effort: 'high', description: 'High' }, { effort: 'xhigh', description: 'Extra High' }],
  shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority: prio,
  model_messages: { instructions_template: 'You are Codex, an agentic coding assistant. Use available tools (including spawn_agent, wait_agent, send_input, close_agent, update_plan, exec_command, and apply_patch) when useful and complete tasks end to end.', instructions_variables: null, approvals: null, collaboration_modes: null, auto_review: null, permissions: null, multi_agent: null, token_budget: null, confirmation_policies: null, guardian_v2: null },
  apply_patch_tool_type: 'function', web_search_tool_type: 'text_and_image', supports_search_tool: true, context_window: 400000, max_output_tokens: 128000,
  auto_compact_token_limit: 350000, effective_context_window_percent: 95, input_modalities: ['text', 'image'], supports_parallel_tool_calls: true, prefer_websockets: false,
  include_plugin_usage_instructions: true, include_apps_usage_instructions: true, include_skills_usage_instructions: true, node_repl_disabled: false, tool_mode: 'standard',
  multi_agent_version: 'v2', multi_agent_reasoning_effort: 'high'
})
export function montarCatalogo (ids, nativo) {
  const modelos = []; let prio = 0
  const modelo0 = nativo && (nativo.models.find(m => m.slug === 'gpt-6.1-sol') || nativo.models.find(m => /^gpt-5/.test(m.slug)) || nativo.models[0])
  for (const id of ids) {
    const existente = nativo && nativo.models.find(m => m.slug === id)
    let e
    if (existente) e = JSON.parse(JSON.stringify(existente))
    else if (modelo0) { e = JSON.parse(JSON.stringify(modelo0)); e.slug = id; e.display_name = id }
    else e = entradaPadrao(id, prio)
    e.visibility = 'list'; e.supported_in_api = true; e.priority = prio++
    // CORRECAO PRINCIPAL (mesma do instalador do Windows): com use_responses_lite = true o Codex manda o pedido SEM a lista de ferramentas.
    e.use_responses_lite = false
    modelos.push(e)
  }
  return { models: modelos }
}

// ---------- principal ----------
const normalizar = u => { let x = String(u).trim().replace(/\/+$/, ''); if (!/^https?:\/\//.test(x)) x = 'https://' + x; if (!/\/v1$/.test(x)) x += '/v1'; return x }
async function listarModelos (ep, chave) {
  const r = await fetch(ep + '/models', { headers: { authorization: 'Bearer ' + chave, 'x-api-key': chave, accept: 'application/json', 'user-agent': 'Lauren-Setup/' + VERSAO }, signal: AbortSignal.timeout(25000) })
  if (!r.ok) throw new Error(`A API respondeu ${r.status} ao consultar /models. Confira a chave.`)
  const j = await r.json(); const ids = []
  for (const m of j.data || []) { const id = String(m.id || ''); if (id && !id.startsWith('aihorde/') && !ids.includes(id)) ids.push(id) }
  if (!ids.length) throw new Error('A API nao retornou nenhum modelo para esta chave.')
  return ids
}
const preferido = (lista, pref) => pref.find(p => lista.includes(p)) || lista[0]

function backupOriginal (arquivos) {
  const orig = path.join(BACKUPS, 'original'); const marca = path.join(orig, 'original.json')
  if (existe(marca)) return
  fs.mkdirSync(orig, { recursive: true }); const copiados = {}; const novos = []
  for (const [nome, p] of Object.entries(arquivos)) { if (existe(p)) { fs.copyFileSync(p, path.join(orig, nome)); copiados[nome] = p } else novos.push(p) }
  escrever(marca, JSON.stringify({ files: copiados, novos }, null, 2))
}
function backupDaVez (arquivos) {
  const dir = path.join(BACKUPS, carimbo()); fs.mkdirSync(dir, { recursive: true })
  for (const [nome, p] of Object.entries(arquivos)) if (existe(p)) fs.copyFileSync(p, path.join(dir, nome))
}
const PERFIS = ['.zshrc', '.bashrc', '.profile']
const LINHA_PERFIL = `[ -f "$HOME/.gateway/env" ] && . "$HOME/.gateway/env" ${TAG}`

async function desinstalar () {
  out('[LOG] Restaurando o padrao original...')
  const orig = path.join(BACKUPS, 'original', 'original.json'); const marca = carimbo()
  if (existe(orig)) {
    const o = JSON.parse(ler(orig))
    for (const [nome, destino] of Object.entries(o.files)) { const src = path.join(BACKUPS, 'original', nome); if (existe(src)) { fs.mkdirSync(path.dirname(destino), { recursive: true }); fs.copyFileSync(src, destino) } }
    for (const novo of o.novos) if (existe(novo)) fs.renameSync(novo, novo + '.removido-' + marca)
  } else {
    out('[AVISO] Nao achei a copia original. Retirei so o bloco da Lauren do config.toml do Codex.')
    const c = path.join(CODEX, 'config.toml'); if (existe(c)) escrever(c, limparGerenciado(ler(c)))
  }
  for (const f of Object.values(MCP_ARQUIVOS)) { const p = path.join(CODEX, 'mcp', f); if (existe(p)) fs.rmSync(p) }
  const cat = path.join(CODEX, 'gateway-models-http.json'); if (existe(cat)) fs.rmSync(cat)
  if (existe(ENVARQ)) fs.rmSync(ENVARQ)
  for (const f of PERFIS) { const p = path.join(HOME, f); if (existe(p)) { const t = ler(p); if (t.includes(TAG)) escrever(p, t.split('\n').filter(l => !l.endsWith(TAG)).join('\n'), 0o644) } }
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['unsetenv', 'GATEWAY_API_KEY'], { stdio: 'ignore' }) } catch {} }
  out('[LOG] Padrao restaurado.'); out('GATEWAY_RESTORE_OK')
}

async function instalar () {
  const endpoint = normalizar(valor('endpoint') || process.env.GATEWAY_ENDPOINT || ENDPOINT_PADRAO)
  const alvos = (valor('targets') || process.env.GATEWAY_TARGETS || 'codex,claude-code,opencode').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  let chave = (process.env.GATEWAY_API_KEY || '').replace(/\s/g, '')
  if (!chave) { out(''); out('Instalador Lauren API'); out('Cole a sua chave (ela comeca com lp_) e tecle Enter. A chave nao aparece na tela.'); chave = lerLinha('Chave: ', true).replace(/\s/g, '') }
  if (!/^[A-Za-z0-9._:-]{6,256}$/.test(chave)) throw new Error('Chave de API invalida.')
  out('[LOG] Validando credencial e sincronizando o catalogo real da Lauren API...')
  const ids = await listarModelos(endpoint, chave)
  out(`[LOG] Catalogo validado (${ids.length} modelos reais recebidos).`)
  const gpt = ids.filter(i => !/^claude/.test(i)); const claude = ids.filter(i => /^claude/.test(i))
  const modeloCodex = gpt.length ? preferido(gpt, ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-5.6-sol', 'gpt-5.5']) : null
  const modeloClaude = claude.length ? preferido(claude, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-sonnet-5']) : null
  const temNode = (() => { try { return Number(process.versions.node.split('.')[0]) >= 18 } catch { return false } })()
  if (!flag('yes') && !process.env.GATEWAY_YES) {
    out(''); out(`Vou configurar para usar a Lauren API (${endpoint}):`); out('  Programas: ' + alvos.join(', '))
    out('  Alteracoes: configuracao do Codex (~/.codex), do Claude Code (~/.claude) e do OpenCode (~/.config/opencode), ferramentas MCP em ~/.codex/mcp,')
    out('              e um arquivo ~/.gateway/env (chave, permissao so sua) lido pelo seu shell.')
    out('  Antes de alterar, guardo copia em ~/.gateway/backups. Para desfazer: rode de novo com --uninstall.')
    out('  O seu config.toml do Codex e MESCLADO: o que voce ja tem fica; so o que conflita e comentado.')
    lerLinha('Tecle Enter para instalar (ou Ctrl+C para cancelar): ', false)
  }
  const arquivos = { 'config.toml': path.join(CODEX, 'config.toml'), 'claude-settings.json': CLAUDE, 'opencode.json': OPENCODE, 'AGENTS.md': path.join(CODEX, 'AGENTS.md') }
  backupOriginal(arquivos); backupDaVez(arquivos)
  const instalados = []

  if (alvos.includes('codex') && modeloCodex) {
    out('[LOG] Aplicando perfil no Codex...')
    const catPath = path.join(CODEX, 'gateway-models-http.json')
    const catalogo = montarCatalogo([modeloCodex, ...gpt.filter(g => g !== modeloCodex)], catalogoNativo())
    escrever(catPath, JSON.stringify(catalogo, null, 2), 0o644)
    const cfgPath = arquivos['config.toml']; const atual = existe(cfgPath) ? ler(cfgPath) : ''
    const mcpDir = path.join(CODEX, 'mcp'); fs.mkdirSync(mcpDir, { recursive: true })
    const mcpTabelas = []
    const temNodeRepl = /^\s*\[mcp_servers\.node_repl\]/m.test(limparGerenciado(atual))
    for (const [nome, arq] of Object.entries(MCP_ARQUIVOS)) {
      if (!MCP_B64[nome]) continue
      escrever(path.join(mcpDir, arq), Buffer.from(MCP_B64[nome], 'base64').toString('utf8'), 0o644)
      if (nome === 'node_repl' && temNodeRepl) continue   // o Codex ja tem o dele: nao substituir
      mcpTabelas.push('', `[mcp_servers.${nome}]`, `command = ${JSON.stringify(process.execPath)}`, `args = [${JSON.stringify(path.join(mcpDir, arq))}]`, 'enabled = true', 'startup_timeout_sec = 30', `tool_timeout_sec = ${nome === 'codex_powerpack' ? 180 : 120}`)
    }
    escrever(path.join(CODEX, 'AGENTS.md'), AGENTS, 0o644)
    const q = JSON.stringify
    const novo = mesclarToml(atual, {
      topo: [`model = ${q(modeloCodex)}`, 'model_provider = "gateway"', `model_catalog_json = ${q(catPath)}`, 'model_reasoning_effort = "xhigh"', 'model_reasoning_summary = "detailed"', 'model_verbosity = "high"', 'approval_policy = "on-request"', 'sandbox_mode = "workspace-write"', 'web_search = "live"'],
      mesclar: { features: [['multi_agent', 'true'], ['plugins', 'true'], ['apps', 'true'], ['standalone_web_search', 'true'], ['network_proxy', 'false']], sandbox_workspace_write: [['network_access', 'true']] },
      substituir: ['model_providers.gateway', 'mcp_servers.codex_powerpack', 'mcp_servers.sequential_thinking', 'mcp_servers.memory', 'mcp_servers.context7', ...(temNodeRepl ? [] : ['mcp_servers.node_repl'])],
      acrescentar: ['[model_providers.gateway]', 'name = "Gateway"', `base_url = ${q(endpoint)}`, 'env_key = "GATEWAY_API_KEY"', 'wire_api = "responses"', 'requires_openai_auth = true', 'supports_websockets = false', 'supports_standalone_web_search = true', '', '[model_providers.gateway.http_headers]', `Authorization = ${q('Bearer ' + chave)}`, `x-api-key = ${q(chave)}`, 'X-Gateway-Tools-Compatibility = "functions-v1"', ...mcpTabelas]
    })
    escrever(cfgPath, novo)
    instalados.push('Codex (' + modeloCodex + ')')
  }
  if (alvos.includes('claude-code') && modeloClaude) {
    out('[LOG] Aplicando perfil no Claude Code...')
    let s = {}; try { s = JSON.parse(ler(CLAUDE)) } catch { s = {} }
    const raiz = endpoint.replace(/\/v1$/, '')
    s.model = modeloClaude; s.availableModels = claude
    s.env = { ...(s.env || {}), ANTHROPIC_BASE_URL: raiz, ANTHROPIC_AUTH_TOKEN: chave, ANTHROPIC_API_KEY: chave, ANTHROPIC_MODEL: modeloClaude, ANTHROPIC_DEFAULT_OPUS_MODEL: modeloClaude, ANTHROPIC_DEFAULT_SONNET_MODEL: modeloClaude, ANTHROPIC_DEFAULT_HAIKU_MODEL: modeloClaude, CLAUDE_CODE_SUBAGENT_MODEL: modeloClaude, ANTHROPIC_SMALL_FAST_MODEL: modeloClaude }
    escrever(CLAUDE, JSON.stringify(s, null, 2)); instalados.push('Claude Code (' + modeloClaude + ')')
  }
  if (alvos.includes('opencode') && modeloCodex) {
    out('[LOG] Aplicando perfil no OpenCode...')
    let d = {}; try { d = JSON.parse(ler(OPENCODE)) } catch { d = {} }
    d.provider = d.provider || {}
    d.provider.gateway = { npm: '@ai-sdk/openai-compatible', name: 'Gateway', options: { baseURL: endpoint, apiKey: chave }, models: Object.fromEntries(gpt.map(g => [g, { name: g, limit: { context: 400000, output: 128000 }, reasoning: true }])) }
    d.model = 'gateway/' + modeloCodex
    escrever(OPENCODE, JSON.stringify(d, null, 2)); instalados.push('OpenCode (' + modeloCodex + ')')
  }
  // chave para o shell (Codex le GATEWAY_API_KEY) e, no Mac, para aplicativos abertos pelo Dock
  escrever(ENVARQ, `export GATEWAY_API_KEY=${JSON.stringify(chave)}\n`, 0o600)
  const perfis = PERFIS.map(f => path.join(HOME, f)).filter(existe)
  if (!perfis.length) perfis.push(path.join(HOME, '.profile'))
  for (const p of perfis) { const t = existe(p) ? ler(p) : ''; if (!t.includes(TAG)) escrever(p, t + (t.endsWith('\n') || !t ? '' : '\n') + LINHA_PERFIL + '\n', 0o644) }
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['setenv', 'GATEWAY_API_KEY', chave], { stdio: 'ignore' }) } catch {} }
  if (!temNode) out('[AVISO] Node.js 18 ou mais novo nao encontrado: as ferramentas extras (MCP) so funcionam com ele. https://nodejs.org')
  out('[LOG] Configuracao aplicada: ' + (instalados.join(', ') || 'nada (nenhum modelo compativel)'))
  out('Abra um terminal novo (ou rode: source ~/.gateway/env) e FECHE o Codex por completo antes de abrir de novo.')
  out('GATEWAY_INSTALL_OK')
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  (async () => { try { if (flag('uninstall')) await desinstalar(); else await instalar() } catch (e) { console.error('[ERRO] ' + e.message); process.exit(1) } })()
}

<div align="center">

# Lauren API + Codex e Claude Code

**Use o Codex, o Claude Code e o OpenCode com a [Lauren API](https://api.ialauren.com). Um comando, sem baixar programa.**

[![Licença MIT](https://img.shields.io/badge/licença-MIT-green.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-v1.2.2-blue)
![Mac e Linux](https://img.shields.io/badge/Mac%20e%20Linux-v1.0.0-blue)

</div>

> **Aviso:** este projeto é independente e **não tem ligação com a Anthropic nem com a OpenAI**. "Claude", "Claude Code", "Codex" e "GPT" são marcas dos seus donos e aparecem aqui só para dizer com o quê o instalador é compatível. Os modelos que você recebe dependem do seu plano na Lauren API.

## O que é

Um instalador em PowerShell que configura, no seu computador, os programas abaixo para usarem a **Lauren API** no lugar do endereço padrão deles:

| Programa | O que é configurado |
|---|---|
| **Codex** (Desktop e linha de comando) | `~/.codex/config.toml`, catálogo de modelos e ferramentas extras |
| **Claude Code** | `~/.claude/settings.json` |
| **Claude Desktop** | mesma configuração do Claude Code (veja "Limitações") |
| **OpenCode** | `~/.config/opencode/opencode.json` |

Você cola **um comando**, digita a sua chave (ela **não aparece na tela** e **nunca** vai neste repositório) e o instalador faz o resto. Antes de mexer em qualquer arquivo ele **mostra o que vai fazer** e guarda **cópia de segurança**.

## Instalar no Windows

1. Abra o **PowerShell** (menu Iniciar, digite *PowerShell*).
2. Cole e tecle **Enter**:

```powershell
irm https://raw.githubusercontent.com/LinkjohnDEV/api-claude-gpt-nativa/v1.2.2/windows/instalar.ps1 | iex
```

   Se você **não** abriu como administrador, o instalador **para e oferece reabrir sozinho como administrador** (o Windows pede uma confirmação: clique em *Sim*). Isso é necessário para o Codex Desktop funcionar por completo. Quem só quer Claude Code ou OpenCode pode seguir sem administrador: `$env:GATEWAY_SEM_ADMIN='1'` antes do comando.
3. Cole a sua chave (começa com `lp_`) e tecle Enter.
4. Leia o resumo e tecle **Enter** para instalar (ou `Ctrl+C` para cancelar).
5. **Feche o Codex por completo** (inclusive o ícone perto do relógio) e abra de novo.

A chave é testada **antes** de qualquer alteração. Se estiver errada, nada é mexido.

### Desfazer

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/LinkjohnDEV/api-claude-gpt-nativa/v1.2.2/windows/instalar.ps1))) -Uninstall
```

Volta os arquivos **exatamente** ao que eram antes da primeira instalação, remove as ferramentas e a variável da chave. O que não existia antes é renomeado (`.removido-data`), nunca apagado.

## Instalar no Mac e no Linux

No **Terminal**:

```bash
curl -fsSL https://raw.githubusercontent.com/LinkjohnDEV/api-claude-gpt-nativa/v1.3.0/unix/instalar.sh | bash
```

Ele pede a sua chave (escondida), mostra o que vai fazer e espera um **Enter**. Depois abra um terminal novo e **feche o Codex por completo** antes de abrir de novo.

**Desfazer:**

```bash
curl -fsSL https://raw.githubusercontent.com/LinkjohnDEV/api-claude-gpt-nativa/v1.3.0/unix/instalar.sh | bash -s -- --uninstall
```

Opções: `--yes` (não pergunta), `--targets=codex,claude-code,opencode`, `--endpoint=https://...`. A chave também pode vir da variável `GATEWAY_API_KEY`.

**Diferenças para o Windows:**
- O seu `~/.codex/config.toml` é **mesclado**, não reescrito: o que você já tem fica, e só o que conflita é comentado (volta ao desinstalar).
- Sem as partes que só existem no Windows (controle do computador e a regra do sistema em `ProgramData`). Não precisa de administrador nem de `sudo`.
- Não mexe no histórico de conversas do Codex.
- A chave fica em `~/.gateway/env` (permissão só sua) e é lida pelo seu terminal; no Mac também vai para os aplicativos abertos pelo Dock (`launchctl`, até reiniciar).

**Testado** em Linux (Debian, Node 20), incluindo instalar duas vezes e desinstalar voltando os arquivos idênticos ao original. **No Mac ainda não foi testado em máquina real**: se der problema, abra uma [issue](../../issues/new/choose).

SHA-256 de `unix/instalar.sh` nesta versão:

```
5bad6d38279b889e9c100b617aa8c3f41883c2b90b62749ea6a28c658cccac52
```

## Requisitos

- **Windows:** 10 ou 11 com PowerShell 5.1 ou mais novo (já vem no Windows)
- **Mac e Linux:** `curl` e **Node.js 18 ou mais novo**
- **Node.js** (https://nodejs.org) também é usado pelas ferramentas extras
- Uma chave da Lauren API

## O que muda no seu computador

- Arquivos de configuração do Codex, do Claude Code e do OpenCode (lista acima)
- A variável de ambiente do **seu usuário** `GATEWAY_API_KEY` (a sua chave)
- Ferramentas extras em `~/.codex/mcp` e o catálogo em `~/.codex`
- A regra do sistema do Codex Desktop em `C:\ProgramData\OpenAI\Codex\requirements.toml` (precisa de administrador). **Ela guarda a sua chave em texto**, e qualquer usuário deste computador consegue ler esse arquivo. Use em computador pessoal.
- O Codex é **fechado** durante a instalação
- As **conversas antigas do Codex** (`~/.codex/sessions`) têm o nome do provedor trocado para `gateway`, para continuarem abrindo. Só o rótulo muda, o texto não.
- Antes de qualquer mudança: cópia em `~/.gateway/backups` (a pasta `original` guarda o estado de antes da primeira instalação)

Os arquivos que ele **reescreve** (`config.toml`, `AGENTS.md`, as configurações do Claude e do OpenCode) ficam salvos no backup antes. Ele **não apaga** nenhum outro arquivo seu.

## Ferramentas extras incluídas

O código-fonte de todas está em [`ferramentas/`](ferramentas/) para você ler antes de instalar.

Busca na web, leitura e edição de arquivos, busca de código, memória, raciocínio em etapas, documentação (Context7), REPL de Node, **execução de comandos no PowerShell**, **controle do computador (mouse e teclado)** e **remoção de pastas**.

> As ferramentas de **execução de comandos**, de **controle do computador** e de **remoção de pastas rodam sem pedir confirmação a cada uso**, para o trabalho ser automático. Isso é poderoso e **tem risco**: uma instrução escondida numa página ou arquivo que o modelo leia pode tentar usá-las. **Use em computador de confiança** e leia [SECURITY.md](SECURITY.md).

## Verificar o arquivo (opcional)

SHA-256 de `windows/instalar.ps1` nesta versão:

```
9247bb0d9da329f3f438a979db49e7dc6988c8b786ca0351be04ccc1e5cec35d
```

```powershell
(Get-FileHash .\instalar.ps1 -Algorithm SHA256).Hash
```

## Problemas comuns

Veja [docs/solucao-de-problemas.md](docs/solucao-de-problemas.md). O mais comum: **o Codex responde "vou abrir o site…" e não faz nada**. Está explicado lá, e a versão 1.2 já corrige.

## Limitações

- O **Claude Desktop** recebe a mesma configuração do Claude Code. Não confirmamos que o aplicativo a leia em todas as versões.
- O Codex Desktop muda com frequência. Depois de uma atualização dele pode ser preciso uma nova versão do instalador. Veja o [CHANGELOG](CHANGELOG.md).

## Contribuir

Contribuições são bem-vindas: [CONTRIBUTING.md](CONTRIBUTING.md). Achou um problema de segurança? Veja [SECURITY.md](SECURITY.md) e **não** abra uma issue pública.

## Licença

[MIT](LICENSE). O instalador parte do trabalho de um colaborador (*Gateway Setup v7.0*), com as mudanças da Lauren descritas no [CHANGELOG](CHANGELOG.md).

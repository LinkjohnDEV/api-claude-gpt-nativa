# Changelog

Versões do instalador do Windows. Cada versão é uma *tag* que **nunca é alterada**: para corrigir algo, sai uma versão nova.

## v1.2.0 (2026-11-19)
- **Correção principal:** o catálogo de modelos agora sai com `use_responses_lite = false` em todos os modelos. Com `true` (como vem no catálogo nativo de alguns modelos do Codex Desktop) o Codex manda o pedido **sem a lista de ferramentas**, e o modelo responde "vou abrir o site…" sem conseguir fazer nada.
- **Limpeza segura:** a instalação não apaga mais todos os arquivos `.toml` da pasta do Codex, nem todos os `*-models-*.json`, nem os outros arquivos da pasta de política do sistema. Só mexe no que é dela.
- Aviso quando falta **Administrador**, e conferência no fim de que a regra do sistema do Codex Desktop foi gravada.
- Pede a chave na hora (escondida) e mostra o que vai fazer antes de instalar.
- **Desinstalar de verdade:** volta ao estado de **antes da primeira instalação** (inclusive depois de instalar várias vezes), remove as ferramentas e a variável da chave, e guarda o `AGENTS.md` original.

## Origem
Baseado no *Gateway Setup v7.0*. As mudanças acima são da Lauren.

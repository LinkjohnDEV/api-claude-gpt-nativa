# Solução de problemas

## O Codex responde "vou abrir o site…" (ou "deixe-me carregar as instruções") e não faz nada
**Causa:** o Codex mandou o pedido **sem a lista de ferramentas**. Acontece quando o catálogo de modelos tem `use_responses_lite = true`.
**Solução:** use a **v1.2.1** ou mais nova do instalador (ela corrige isso) e **feche o Codex por completo** (inclusive o ícone perto do relógio) antes de abrir de novo.
**Se estava na v1.0 ou v1.1,** rode o comando da versão atual por cima.

## "A execução de scripts está desabilitada"
O comando `irm … | iex` normalmente não tem esse problema. Se aparecer, copie a mensagem completa e abra uma issue.

## O instalador parou e pediu Administrador
O Codex Desktop precisa de uma regra no sistema (`C:\ProgramData\OpenAI\Codex`) que só é gravada como administrador. Tecle **Enter** quando ele oferecer: o instalador reabre sozinho como administrador e o Windows pede uma confirmação (clique em **Sim**). Se você cancelou a confirmação, abra o PowerShell com *botão direito > Executar como administrador* e rode o comando de novo.
Para instalar só Claude Code ou OpenCode, sem administrador: `$env:GATEWAY_SEM_ADMIN='1'` antes do comando.

## Não pediu a chave dessa vez
Normal: a chave da instalação anterior ficou guardada na variável `GATEWAY_API_KEY` do seu usuário e foi reaproveitada. Para usar **outra** chave, rode o desinstalar antes.

## Como saber se está usando a Lauren
Peça algo simples ao Codex ("diga olá"). Se respondeu e você tem uso na sua conta da Lauren API, está funcionando.

## Quero desfazer tudo
Veja "Desfazer" no [README](../README.md).

## Nada disso resolveu
Abra uma [issue](../../issues/new/choose) com: versão do Windows, versão do Codex, a versão do instalador e a mensagem **exata** do erro (sem a sua chave!).

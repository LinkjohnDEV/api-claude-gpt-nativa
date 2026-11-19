# Segurança

## Como relatar um problema

**Não abra uma issue pública** para vulnerabilidade. Envie um e-mail para **suporte@ialauren.com** com o assunto "Segurança" e:
- o que você encontrou e em qual arquivo/versão;
- como reproduzir;
- o impacto que você imagina.

Respondemos em até **5 dias úteis**. Se o problema for real, publicamos a correção numa versão nova e damos o crédito a você (se quiser).

## O que este instalador faz de sensível

Você roda um script que **altera arquivos do seu computador**. Por isso:
- Leia o script antes de rodar (`windows/instalar.ps1`) e confira o SHA-256 publicado no README.
- Use sempre o comando com a **versão fixa** (`v1.2.0`), nunca com `main`.
- A sua chave **não vai** no comando nem no repositório. Fica na variável de ambiente do seu usuário e nos arquivos de configuração dos programas.

## Riscos conhecidos (por decisão de projeto)

1. **Ferramentas sem confirmação.** As ferramentas de execução de comandos, de controle do computador (mouse e teclado) e de remoção de pastas rodam **sem pedir confirmação a cada uso**. Uma instrução maliciosa escondida em uma página, e-mail ou arquivo que o modelo leia (*prompt injection*) pode tentar usá-las. **Use em computador de confiança.**
2. **Chave em texto no computador.** A regra do sistema do Codex Desktop (`C:\ProgramData\OpenAI\Codex\requirements.toml`) guarda a chave em texto, legível por qualquer usuário do computador. Não use em computador compartilhado.
3. **Conversas antigas do Codex** têm o nome do provedor reescrito (só o rótulo).

Se você acha que algum desses pontos deveria ser diferente, **abra uma issue**: são decisões em aberto, não segredos.

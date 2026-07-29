# Adapters dos consumidores

Cada aplicação depende da porta `AutomationAdapter`, não de Playwright, Puppeteer ou Selenium
diretamente. O adapter remoto envia o plano para a API v2; o adapter local preserva a implementação
atual durante a migração.

Esse é o contrato padrão de todos os serviços da VPS: remoto primeiro, Playwright local como
fallback. A plataforma pode ser instalada em outra VPS; basta trocar URL e API key do adaptador, sem
alterar os testes declarativos.

## Seleção da matriz

`drivers` e `browsers` são filtros opcionais. O cliente omite campos ausentes ou arrays vazios.
Consequentemente, o padrão executa todas as combinações habilitadas pelo deployment. Uma aplicação
só envia filtros quando sua regra exige explicitamente um driver ou navegador.

## Failover seguro

O adapter composto usa o caminho local somente quando a indisponibilidade aconteceu antes de o
serviço aceitar o job:

- falha de DNS, conexão ou timeout no `POST`;
- HTTP `429`, `502`, `503` ou `504` no `POST`.

Erros de contrato e autorização não acionam fallback. Depois de um `200` ou `202` com `jobId`, uma
falha de polling produz `BrowserAutomationOutcomeUnknownError`. O consumidor deve recuperar o mesmo
job pela chave de idempotência; nunca deve repetir localmente uma ação que pode ter sido executada.

## Aplicação por projeto

- Weslei Bassotto e Dias & Kovaltchuk: Playwright Test continua como runner local completo; planos
  portáveis podem ser enviados ao serviço para a matriz de regressão.
- NSC Bot e WhatsApp Forms Office: a porta de Forms seleciona remoto/local. Preenchimento e envio
  exigem idempotência por promoção e participante.
- WhatsApp API: a sessão autenticada e persistente do WhatsApp não é um job stateless; continua nos
  adapters Baileys/whatsapp-web.js.
- WhatsApp Message Scheduler: não usa navegador e não recebe uma dependência artificial.

Essa separação impede que uma queda do serviço troque uma sessão persistente de máquina ou duplique
envios de formulário e mensagens.

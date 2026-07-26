# Browser Automation Service

Serviço compartilhado de automação de navegadores para a VPS. Um control plane comum cuida de
autenticação, leases, fila, limites e métricas. Há dois contratos:

- **jobs portáveis:** um JSON declarativo é convertido para Playwright, Puppeteer ou Selenium e pode
  ser executado em toda a matriz suportada;
- **sessões nativas:** o consumidor escolhe driver e navegador e continua usando a biblioteca
  original por WebSocket/CDP/WebDriver.

| Driver     | Protocolo nativo            | Navegadores da facade                     |
| ---------- | --------------------------- | ----------------------------------------- |
| Playwright | Playwright WebSocket        | Chromium, Firefox e WebKit                |
| Puppeteer  | Chrome DevTools / BiDi      | Chromium e Firefox                        |
| Selenium   | WebDriver via Selenium Grid | configurável: Chromium, Firefox e/ou Edge |

Combinações fisicamente inexistentes, como Puppeteer + WebKit, aparecem como `unsupported`; o
serviço nunca finge ter executado uma combinação.

Veja [a arquitetura detalhada](docs/architecture.md).

## Tecnologias

- Node.js 24 e TypeScript estrito;
- Fastify para HTTP e WebSocket;
- Playwright, Puppeteer e Selenium WebDriver;
- Selenium Grid opcional no Docker Compose;
- fila FIFO em memória em uma única réplica;
- Docker com processos, memória e CPU limitados.

## API

Todos os endpoints, exceto health checks, exigem `Authorization: Bearer <API_KEY>` ou
`X-API-Key: <API_KEY>`.

### Descobrir capacidades

```http
GET /v1/engines
Authorization: Bearer ...
```

A resposta informa os drivers habilitados e cada combinação `driver + browser` disponível.

### Executar um job na matriz

```http
POST /v1/jobs/run
Authorization: Bearer ...
Content-Type: application/json

{
  "schemaVersion": 1,
  "clientId": "site-regression",
  "steps": [
    { "action": "goto", "url": "https://example.com" },
    { "action": "setViewport", "width": 1280, "height": 720 },
    { "action": "waitForSelector", "selector": "h1", "state": "visible" },
    {
      "action": "assert",
      "kind": "text",
      "selector": "h1",
      "operator": "contains",
      "expected": "Example"
    },
    { "action": "extract", "kind": "title", "as": "pageTitle" },
    { "action": "screenshot", "as": "finalPage", "fullPage": true }
  ]
}
```

Sem `drivers` e `browsers`, o job roda em **todas as capacidades habilitadas**. Filtros são
opcionais:

```json
{
  "drivers": ["playwright", "selenium"],
  "browsers": ["chromium", "firefox"]
}
```

Quando os dois filtros são enviados, o serviço avalia o produto cartesiano solicitado. Combinações
não suportadas ficam registradas como `unsupported`; as demais continuam executando. Cada execução
tem status, duração, passos e outputs independentes. O resultado geral é `passed`, `failed` ou
`partial`.

O schema v1 oferece:

- navegação: `goto`, `back`, `forward`, `reload`;
- interação: `click`, `fill`, `type`, `press`, `hover`, `focus`, `check`, `uncheck`, `select`,
  `scroll`;
- sincronização: `wait`, `waitForSelector`, `waitForUrl`;
- contexto: `setViewport`;
- verificação e dados: `assert`, `extract`, `screenshot`.

`extract` e `assert` aceitam `attribute`, `count`, `html`, `text`, `title`, `url`, `value` e
`visible`. Screenshots retornam base64 no output indicado por `as`. O contrato não aceita `eval` nem
JavaScript arbitrário.

### Solicitar uma sessão nativa

```http
POST /v1/leases
Authorization: Bearer ...
Content-Type: application/json

{
  "clientId": "whatsapp-forms-office",
  "engine": "playwright",
  "browser": "chromium",
  "waitTimeoutMs": 60000
}
```

Resposta `201`:

```json
{
  "leaseId": "9e3b...",
  "leaseToken": "secret...",
  "engine": "playwright",
  "browser": "chromium",
  "expiresAt": "2026-07-26T15:00:00.000Z",
  "connection": {
    "protocol": "playwright",
    "endpoint": "ws://browser-automation-service:3000/v1/leases/9e3b.../connect?token=..."
  },
  "versions": {
    "playwright": "1.61.1",
    "puppeteer": "25.3.0",
    "selenium": "4.46.0"
  }
}
```

O endpoint e o token são segredos temporários e não devem aparecer em logs. Ao fechar a conexão, o
processo é encerrado e a próxima solicitação FIFO recebe capacidade.

Respostas relevantes:

- `400`: contrato inválido;
- `408`: espera na fila expirou;
- `422`: driver/navegador não habilitado;
- `429`: sem capacidade imediata ou fila cheia;
- `503`: serviço encerrando.

Para Playwright, cliente e servidor precisam usar o mesmo `major.minor`. No Puppeteer, use
`puppeteer.connect({ browserWSEndpoint })`. No Selenium, use `new Builder().usingServer(endpoint)` e
encerre com `driver.quit()`.

Puppeteer + Firefox usa uma única sessão WebDriver BiDi e, por isso, está disponível na facade de
jobs, mas não como lease nativo reconectável. Uma solicitação nativa dessa combinação retorna `422`.

### Encerrar uma sessão nativa

```http
DELETE /v1/leases/{leaseId}?token={leaseToken}
Authorization: Bearer ...
```

## Selenium Grid

Somente Chromium:

```bash
BROWSER_SELENIUM_REMOTE_URL=http://selenium-hub:4444/wd/hub
SELENIUM_BROWSERS=chromium
docker compose --profile selenium up -d
```

Chromium, Firefox e Edge:

```bash
BROWSER_SELENIUM_REMOTE_URL=http://selenium-hub:4444/wd/hub
SELENIUM_BROWSERS=chromium,firefox,edge
docker compose --profile selenium-all up -d
```

Essas variáveis devem estar no `.env` usado pelo serviço.

## Redis, PostgreSQL e Keycloak

Nenhum é obrigatório na implantação inicial:

- **Redis:** entra para jobs assíncronos, várias réplicas, retries e backpressure. O Redis existente
  do NSC Bot só deve ser compartilhado com prefixo, credencial e SLA isolados.
- **PostgreSQL:** entra para tenants, políticas, auditoria durável e histórico de jobs.
- **Keycloak:** entra quando houver múltiplos serviços/equipes, escopos por cliente ou acesso fora
  da rede privada. Internamente, uma API key rotacionável é mais simples.

Leases e referências a processos continuam efêmeros, mesmo com banco.

## Execução local

```powershell
Copy-Item .env.example .env
# substitua API_KEY por um segredo aleatório de pelo menos 32 caracteres
npm.cmd ci
npx.cmd playwright install chromium firefox webkit
# Puppeteer + Firefox requer o Firefox indicado em node_modules/puppeteer-core/src/revisions.ts.
# Instale-o com @puppeteer/browsers e defina PUPPETEER_FIREFOX_EXECUTABLE_PATH.
npm.cmd run check
npm.cmd run dev
```

A imagem Docker já instala e configura a revisão correta do Firefox para o Puppeteer.

## Docker e VPS

```bash
cp .env.example .env
# edite .env e use: openssl rand -hex 32
docker compose build
docker compose up -d
docker compose ps
```

A porta é publicada apenas em `127.0.0.1`. Containers consumidores entram na rede privada
`browser-automation`. Não publique os endpoints na internet. O container principal roda como
`pwuser`, sem capabilities, com `no-new-privileges`, init e `/dev/shm` dedicado.

## Operação

- `GET /health/live`: processo HTTP vivo;
- `GET /health/ready`: control plane pronto;
- `GET /metrics`: métricas Prometheus protegidas pela chave;
- logs estruturados sem tokens;
- shutdown gracioso fecha leases e processos filhos.

O endpoint de jobs é síncrono nesta versão. Para matrizes demoradas, aumente o timeout do proxy ou
evolua para a fila Redis descrita em [docs/architecture.md](docs/architecture.md).

## Ordem de migração

1. Validar Weslei Bassotto ou Dias/Kovaltchuk pela facade de jobs.
2. Migrar testes simples para o JSON portável, mantendo testes específicos em sessão nativa.
3. Ativar Selenium Grid conforme a necessidade real da VPS.
4. Migrar NSC Bot e Whats Forms apenas nos fluxos efêmeros.

O Chromium persistente do `whatsapp-web.js` permanece local, pois mantém perfil, autenticação e
ciclo de vida longo. Binaural não faz parte desta iniciativa.

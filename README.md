# Browser Automation Service

Plataforma compartilhada de automação de navegadores para a VPS. Um control plane comum cuida de
autenticação, leases, fila, limites e métricas; adapters preservam o protocolo nativo de cada
engine.

| Engine     | Protocolo entregue          | Estado                     |
| ---------- | --------------------------- | -------------------------- |
| Playwright | Playwright WebSocket        | implementado               |
| Puppeteer  | Chrome DevTools (CDP)       | implementado               |
| Selenium   | WebDriver via Selenium Grid | opcional no Docker Compose |

O consumidor escolhe `engine` ao solicitar o lease. A automação existente continua usando a
biblioteca original; muda somente `launch()` para `connect()`/remote driver.

## Por que não existe um “conversor universal”

Playwright, CDP e WebDriver não possuem capacidades idênticas. Traduzir comandos arbitrários entre
eles perderia recursos como contexts, tracing, interceptação de rede e WebDriver BiDi.

A arquitetura oferece dois níveis:

1. **Sessão nativa:** já implementada; preserva todas as capacidades do engine e exige alteração
   apenas no ponto de conexão.
2. **Facade de jobs:** extensão planejada para ações portáveis e limitadas, como `navigate`,
   `click`, `fill` e `screenshot`. Cada adapter traduzirá essas ações. Não aceitará JavaScript
   arbitrário.

Assim, fluxos complexos permanecem fiéis ao engine e fluxos simples poderão trocar de engine sem
alterar sua regra de negócio.

Veja [a arquitetura detalhada](docs/architecture.md).

## Tecnologias

- Node.js 24 e TypeScript estrito;
- Fastify para o control plane HTTP;
- Playwright e Puppeteer/CDP para providers locais;
- Selenium Grid opcional para WebDriver;
- fila FIFO em memória na implantação de uma única instância;
- Docker com processos e limites isolados.

Node/TypeScript reduz bridges porque os consumidores atuais e dois dos três engines já são nativos
desse ecossistema.

## API

Todos os endpoints, exceto health checks, exigem `Authorization: Bearer <API_KEY>` ou
`X-API-Key: <API_KEY>`.

### Engines disponíveis

```http
GET /v1/engines
Authorization: Bearer ...
```

### Solicitar uma sessão

```http
POST /v1/leases
Authorization: Bearer ...
Content-Type: application/json

{
  "clientId": "whatsapp-forms-office",
  "engine": "playwright",
  "waitTimeoutMs": 60000
}
```

Resposta `201`:

```json
{
  "leaseId": "9e3b...",
  "leaseToken": "secret...",
  "engine": "playwright",
  "expiresAt": "2026-07-26T15:00:00.000Z",
  "connection": {
    "protocol": "playwright",
    "endpoint": "ws://browser-automation-service:3000/v1/leases/9e3b.../connect?token=..."
  },
  "versions": {
    "playwright": "1.61.1",
    "puppeteer": "25.3.0"
  }
}
```

O endpoint e o token são segredos temporários e não devem aparecer em logs. Ao fechar a conexão, o
processo do navegador é encerrado e a próxima solicitação FIFO recebe capacidade.

Respostas relevantes:

- `408`: espera na fila expirou;
- `422`: engine não habilitado;
- `429`: sem capacidade imediata ou fila cheia;
- `503`: serviço encerrando.

### Playwright

```ts
const lease = await requestLease("playwright");
const browser = await chromium.connect(lease.connection.endpoint);
```

Cliente e servidor Playwright precisam usar o mesmo `major.minor`. Os projetos auditados resolvem
atualmente para `1.61.1`, por isso a versão está fixada sem `^`.

### Puppeteer

```ts
const lease = await requestLease("puppeteer");
const browser = await puppeteer.connect({
  browserWSEndpoint: lease.connection.endpoint,
});
```

O provider usa CDP e inicia um Chromium isolado por lease.

### Selenium

Ative o profile e configure a URL:

```bash
SELENIUM_REMOTE_URL=http://selenium-chromium:4444/wd/hub \
docker compose --profile selenium up -d
```

O lease retorna `connection.protocol: "webdriver"` e o endpoint do Grid para
`Builder().usingServer(endpoint)`. O cliente deve chamar `driver.quit()` e depois cancelar o lease.
O Grid também encerra sessões abandonadas após o timeout configurado.

### Encerrar explicitamente

```http
DELETE /v1/leases/{leaseId}?token={leaseToken}
Authorization: Bearer ...
```

## Estado, Redis, PostgreSQL e Keycloak

Nenhum deles é obrigatório na primeira implantação:

- **Redis:** entra quando houver várias réplicas ou quando a facade assíncrona de jobs precisar de
  fila distribuída, retries e backpressure. Ele não recupera um navegador que morreu.
- **PostgreSQL:** entra para tenants, clientes, políticas, auditoria durável e histórico de jobs.
  Leases e referências a processos continuam efêmeros.
- **Keycloak:** entra quando houver múltiplos serviços/equipes, escopos por engine ou acesso fora da
  rede privada. Internamente, uma API key rotacionável é menor e mais simples.

As fronteiras estão descritas em `docs/architecture.md`, evitando colocar regras de Redis,
PostgreSQL ou Keycloak dentro do domínio.

## Execução local

```powershell
Copy-Item .env.example .env
# substitua API_KEY por um segredo aleatório de pelo menos 32 caracteres
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run check
npm.cmd run dev
```

## Docker e VPS

```bash
cp .env.example .env
# edite .env e use: openssl rand -hex 32
docker compose build
docker compose up -d
docker compose ps
```

A porta é publicada apenas em `127.0.0.1`. Containers consumidores entram na rede privada:

```yaml
services:
  consumidor:
    networks:
      - default
      - browser-automation
    environment:
      BROWSER_SERVICE_HTTP_URL: http://browser-automation-service:3000

networks:
  browser-automation:
    external: true
```

Não publique os endpoints de automação na internet. O container principal roda como `pwuser`, sem
capabilities, com `no-new-privileges`, init e `/dev/shm` dedicado. O limite inicial é dois
navegadores/2 GB e deve ser ajustado após medir a VPS.

## Operação

- `GET /health/live`: processo HTTP vivo;
- `GET /health/ready`: control plane pronto;
- `GET /metrics`: métricas Prometheus protegidas pela chave;
- logs estruturados sem registrar tokens;
- shutdown gracioso fecha leases e processos filhos.

## Ordem de migração

1. Weslei Bassotto ou Dias/Kovaltchuk, porque usam E2E e têm menor risco operacional.
2. Formulários do NSC Bot e Whats Forms, trocando apenas `chromium.launch()` por lease +
   `connect()`.
3. Selenium/Puppeteer quando surgir um consumidor real desses protocolos.
4. A facade neutra somente após catalogar ações comuns reais.

O Chromium persistente do `whatsapp-web.js` permanece local: ele mantém perfil, autenticação e ciclo
de vida longo. Binaural não faz parte desta iniciativa.

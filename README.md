# Browser Automation Service

Plataforma assíncrona e durável de automação de navegadores para serviços hospedados na VPS. Cada
consumidor envia um plano declarativo tipado; o serviço compila o job para a matriz real de
Playwright, Puppeteer e Selenium sem exigir alterações no código do consumidor.

Quando `drivers` e `browsers` não são informados, o job é executado em todas as combinações
habilitadas. Quando são informados, funcionam como filtros. Combinações fisicamente impossíveis,
como Puppeteer com WebKit, são registradas como `unsupported` em vez de serem simuladas.

## Matriz

| Driver     | Chromium | Firefox  | WebKit | Edge     |
| ---------- | -------- | -------- | ------ | -------- |
| Playwright | sim      | sim      | sim    | não      |
| Puppeteer  | sim      | sim      | não    | não      |
| Selenium   | opcional | opcional | não    | opcional |

A instalação padrão executa cinco combinações Playwright/Puppeteer. O profile `selenium-all`
adiciona Chromium, Firefox e Edge, totalizando oito.

## Arquitetura

- Node.js 24 LTS e TypeScript estrito;
- Fastify e TypeBox como contrato HTTP/OpenAPI;
- PostgreSQL como fonte de verdade de jobs, execuções, idempotência, clientes e artefatos;
- outbox transacional no PostgreSQL;
- BullMQ sobre Redis para filas separadas por driver;
- processos independentes para API, dispatcher e workers;
- storage local ou S3 compatível para artefatos, selecionado por configuração;
- migrações numeradas, transacionais e protegidas por advisory lock;
- claim atômico de execução e quota transacional por cliente;
- logs JSON estruturados com redaction de credenciais;
- autenticação por API key com SHA-256 e escopos armazenados no PostgreSQL;
- OpenTelemetry via OTLP HTTP;
- bloqueio de SSRF para destinos privados, com allowlist explícita;
- cobertura obrigatória de 100% em linhas, branches, statements e funções.

O Redis do NSC Bot pode ser reaproveitado somente com credencial, database/prefixo e SLA isolados. O
Compose fornece Redis próprio por padrão. Keycloak não foi colocado no caminho crítico da rede
interna: a porta `Authenticator` permite adicioná-lo quando houver múltiplos tenants, acesso externo
ou necessidade de OAuth2 client credentials.

Veja [a arquitetura detalhada](docs/architecture.md). Veja também a
[política de adapters e failover dos consumidores](docs/consumer-adapters.md).

## API v2

Os health checks são públicos. Os demais endpoints exigem `X-API-Key` ou
`Authorization: Bearer <chave>`. O cliente bootstrap recebe todos os escopos na inicialização.

| Método | Endpoint                    | Escopo              | Resultado                        |
| ------ | --------------------------- | ------------------- | -------------------------------- |
| GET    | `/health/live`              | público             | processo vivo                    |
| GET    | `/health/ready`             | público             | PostgreSQL e Redis prontos       |
| GET    | `/v2/capabilities`          | `capabilities:read` | matriz habilitada                |
| POST   | `/v2/jobs/plan`             | `jobs:write`        | plano sem executar               |
| POST   | `/v2/jobs`                  | `jobs:write`        | cria job assíncrono              |
| GET    | `/v2/jobs/{id}`             | `jobs:read`         | snapshot do job                  |
| GET    | `/v2/jobs/{id}/events`      | `jobs:read`         | stream SSE até estado terminal   |
| POST   | `/v2/jobs/{id}/cancel`      | `jobs:write`        | cancelamento cooperativo         |
| POST   | `/v2/executions/{id}/retry` | `jobs:write`        | retry de falha de infraestrutura |
| GET    | `/v2/artifacts/{id}`        | `artifacts:read`    | conteúdo do artefato             |
| GET    | `/docs`                     | configuração        | Swagger UI                       |

### Criar um job

```http
POST /v2/jobs
X-API-Key: <chave>
Idempotency-Key: regression-home-2026-07-26
Content-Type: application/json

{
  "schemaVersion": 1,
  "clientId": "weslei-bassotto",
  "steps": [
    { "action": "goto", "url": "https://example.com" },
    { "action": "setViewport", "width": 1280, "height": 720 },
    { "action": "waitForSelector", "selector": "h1" },
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

A resposta inicial é `202 Accepted`. A definição recebe fingerprint SHA-256 sobre JSON canônico.
Repetir a mesma definição com a mesma `Idempotency-Key` retorna o job existente com `200 OK`.
Reutilizar a chave com outra definição retorna `409 Conflict`.

Filtros opcionais:

```json
{
  "drivers": ["playwright", "selenium"],
  "browsers": ["chromium", "firefox"]
}
```

Com os dois filtros, o compilador avalia o produto cartesiano solicitado. Sem filtros, usa todas as
capacidades anunciadas pelo deployment.

### Automation Plan v1

- navegação: `goto`, `back`, `forward`, `reload`;
- interação: `click`, `fill`, `type`, `press`, `hover`, `focus`, `check`, `uncheck`, `select`,
  `scroll`;
- sincronização: `wait`, `waitForSelector`, `waitForUrl`;
- contexto: `setViewport`;
- validação e dados: `assert`, `extract`, `screenshot`.

Esta representação intermediária pequena permite executar a mesma intenção em todos os adapters. Não
há conversão textual entre drivers, `eval` nem JavaScript arbitrário. O plano aceita até 100 passos
e limita seletores, strings, dimensões e timeouts. Screenshots são persistidos como artefatos e o
output contém o ID, não base64.

## Estados e falhas

Jobs: `queued`, `running`, `passed`, `partial`, `failed` ou `canceled`.

Execuções: `queued`, `running`, `passed`, `failed`, `unsupported`, `canceled` ou `timed_out`.

Falhas são classificadas como `assertion`, `infrastructure`, `invalid_job` ou `timeout`. Apenas
falhas de infraestrutura podem receber retry manual, limitado a três tentativas. Uma falha em uma
combinação não cancela as demais.

## Desenvolvimento

Requisitos:

- Node.js `24.18.x`;
- npm `11.16.x`;
- Docker com Compose v2 para integração.

```powershell
npm.cmd ci
npm.cmd run check
```

`npm run check` executa formatação, lint, TypeScript, testes com cobertura estrita de 100%, build e
auditoria de dependências.

Para desenvolvimento sem containers, PostgreSQL e Redis precisam estar acessíveis e as variáveis de
`APP_ROLE` devem ser configuradas. Os navegadores locais do Playwright podem ser instalados com:

```powershell
npx.cmd playwright install chromium firefox webkit
```

## Docker Compose

O deployment usa o PostgreSQL compartilhado da VPS pela rede externa `postgres-network`. Antes do
primeiro start, crie o usuário e o banco `browser_automation` no PostgreSQL central e confirme que o
hostname registrado em `secrets/database_url` resolve nessa rede.

Crie uma vez as redes externas da VPS:

```bash
docker network inspect proxy-network >/dev/null 2>&1 || docker network create proxy-network
docker network inspect postgres-network >/dev/null 2>&1 || docker network create postgres-network
docker network inspect browser-automation-network >/dev/null 2>&1 || docker network create browser-automation-network
```

Crie o arquivo de ambiente apenas para configurações não secretas e prepare os Docker Secrets:

```bash
cp .env.example .env
install -d -m 700 secrets
openssl rand -hex 32 > secrets/api_key
openssl rand -hex 32 > secrets/redis_password
cp secrets/database_url.example secrets/database_url
chmod 600 secrets/api_key secrets/redis_password secrets/database_url
# Edite secrets/database_url e use a URL real do PostgreSQL central.
docker compose up -d --build
docker compose ps
```

Os arquivos sem sufixo `.example` são ignorados pelo Git. O Compose monta cada segredo somente nos
serviços que precisam dele, em `/run/secrets`; a chave bootstrap da API não é entregue ao dispatcher
nem aos workers. A aplicação aceita `*_FILE` e mantém somente o hash SHA-256 da chave bootstrap
depois da inicialização da configuração.

O deployment padrão inicia:

- Redis;
- API;
- dispatcher;
- worker Playwright;
- worker Puppeteer.

A API entra nas redes externas `proxy-network`, `postgres-network` e `browser-automation-network`.
Dispatcher e workers entram na rede do PostgreSQL; somente API e processos que realmente abrem
páginas entram na rede dos consumidores.

Um consumidor Docker conecta somente à rede de automação:

```yaml
services:
  app:
    networks:
      - default
      - browser-automation-network

networks:
  browser-automation-network:
    external: true
    name: ${BROWSER_AUTOMATION_NETWORK:-browser-automation-network}
```

Dentro dessa rede, a URL estável da API é `http://browser-automation-api:3000`. Consumidores nunca
entram na `postgres-network`.

A API é publicada somente em `127.0.0.1`. Para habilitar Selenium:

```bash
cat >> .env <<'EOF'
BROWSER_SELENIUM_REMOTE_URL=http://selenium-hub:4444/wd/hub
SELENIUM_BROWSERS=chromium,firefox,edge
EOF
docker compose --profile selenium-all up -d --build
```

Não configure `BROWSER_SELENIUM_REMOTE_URL` se o profile não estiver ativo; assim a API não anuncia
combinações sem worker disponível.

Para usar artefatos S3, crie também `secrets/aws_access_key_id` e `secrets/aws_secret_access_key`,
selecione `ARTIFACT_BACKEND=s3` no `.env` e aplique o overlay:

```bash
cp secrets/aws_access_key_id.example secrets/aws_access_key_id
cp secrets/aws_secret_access_key.example secrets/aws_secret_access_key
chmod 600 secrets/aws_access_key_id secrets/aws_secret_access_key
# Substitua os placeholders pelos valores reais.
docker compose -f compose.yaml -f compose.s3.yaml up -d --build
```

Em uma VPS com suporte a IAM de workload, prefira não criar chaves AWS estáticas e não aplique o
overlay de credenciais.

## Segurança operacional

- mantenha a API atrás do proxy da VPS e não publique Redis, PostgreSQL ou Selenium Grid;
- use chaves aleatórias com pelo menos 32 caracteres;
- não coloque chaves em `.env`; use os arquivos ignorados em `SECRETS_DIR`;
- preencha `ALLOWED_HOSTS` apenas para destinos privados deliberadamente acessíveis;
- os containers removem capabilities, usam `no-new-privileges` e desabilitam core dumps;
- navegadores são efêmeros e não recebem perfis persistentes;
- `whatsapp-web.js` com sessão persistente deve continuar no serviço proprietário;
- artefatos expiram por padrão após 168 horas;
- use um collector OTLP ao definir `OTEL_EXPORTER_OTLP_ENDPOINT`.

No Docker Compose sem Swarm, secrets com origem `file:` são montagens de arquivo protegidas contra
exposição por variável de ambiente, mas continuam armazenadas no host. Restrinja o acesso ao
diretório, ao daemon Docker e ao usuário `root`. Enquanto uma credencial estiver em uso, ela ainda
pode existir transitoriamente na memória do processo.

## Migração dos consumidores

1. Use `/v2/jobs/plan` para verificar a matriz que será criada.
2. Migre testes portáteis de Weslei Bassotto e Dias/Kovaltchuk.
3. Migre fluxos efêmeros do NSC Bot e Whats Forms.
4. Mantenha automações com perfil persistente fora do pool.
5. Ative Selenium somente para jobs que realmente exigem Grid/Edge.

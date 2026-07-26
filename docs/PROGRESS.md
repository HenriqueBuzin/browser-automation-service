# Checkpoint da refatoração assíncrona

Data: 26 de julho de 2026

Branch: `codex/async-platform-refactor`

## Objetivo

Construir uma plataforma nova de automação de navegadores para a VPS. A aplicação cliente envia uma
DSL declarativa única; o compilador expande o job para Playwright, Puppeteer e Selenium e para todos
os navegadores disponíveis quando nenhum filtro é informado. Filtros de driver e navegador continuam
opcionais.

O serviço deve ser assíncrono, durável, seguro para múltiplos consumidores e operável em uma VPS:

- Fastify e TypeScript estrito sobre Node.js 24 LTS;
- PostgreSQL como fonte de verdade de jobs, execuções, idempotência, clientes e artefatos;
- outbox transacional no PostgreSQL e BullMQ sobre Redis para entrega aos workers;
- workers separados por driver, com adapters de sessão para a DSL comum;
- artefatos em storage local substituível;
- autenticação por API key com hash e escopos, preparada para futura integração com Keycloak;
- OpenTelemetry, health checks, retenção de artefatos e shutdown gracioso;
- Docker Compose com API, dispatcher, workers, PostgreSQL, Redis e Selenium Grid opcional;
- 100% de linhas, branches, statements e funções no gate de cobertura.

## Implementado neste checkpoint

- contrato TypeBox da DSL v1 com 21 ações portáteis;
- compilador da matriz e registro explícito de combinações `unsupported`;
- política de destinos com bloqueio de IPs privados e allowlist;
- estados duráveis de job e execução;
- submissão idempotente, quota por cliente e criação atômica de job/outbox;
- repositórios em memória e PostgreSQL;
- dispatcher de outbox, BullMQ e worker host;
- runner de execução com cancelamento cooperativo, classificação de falhas e screenshots;
- storage local e limpeza por retenção;
- API v2 assíncrona, SSE, cancelamento, retry, artefatos, capacidades e OpenAPI;
- autenticação PostgreSQL por escopo;
- telemetria OTLP de traces e métricas;
- imagens Docker e Compose para os serviços da plataforma;
- 73 testes criados ou preservados, cobrindo o núcleo do domínio, aplicação, API e infraestrutura.

## Estado observado antes do commit

- `npm run typecheck`: passou;
- `docker compose config --quiet`: passou, com avisos esperados porque o `.env` real não foi
  preenchido;
- 68 de 73 testes passam;
- cinco testes HTTP falham porque o compilador de schemas do Fastify rejeita atualmente o passo
  `goto` válido antes de chegar aos handlers;
- a cobertura medida sobre todos os arquivos de `src` ainda não é o gate final. A primeira medição,
  feita antes da nova bateria de testes, foi 12,84% de linhas e serviu para revelar arquivos não
  importados pelo conjunto antigo. Uma nova medição deve ser feita depois de corrigir o schema HTTP.

## Próxima sequência

1. Corrigir a compilação/validação do `AutomationJobSchema` no Fastify e voltar a 73/73 testes.
2. Testar integralmente os adapters Playwright, Puppeteer e Selenium com doubles dos SDKs.
3. Cobrir PostgreSQL, BullMQ, OpenTelemetry, composição da plataforma e entrypoints.
4. Fixar o Vitest em 100% para linhas, branches, statements e funções, incluindo todos os módulos de
   produção relevantes.
5. Atualizar completamente o README e a documentação arquitetural antiga.
6. Executar `npm run check`, `npm audit`, builds Docker e integração real com PostgreSQL/Redis.
7. Rodar a matriz real: cinco combinações locais e, no profile completo, oito combinações incluindo
   Selenium Chromium, Firefox e Edge.
8. Revisar segurança/operabilidade, criar o commit final, integrar por fast-forward na `main` e
   enviar ao remoto somente quando todos os gates estiverem verdes.

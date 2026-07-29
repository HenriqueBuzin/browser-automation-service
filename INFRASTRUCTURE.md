# Padrão de infraestrutura

Este repositório segue o mesmo contrato operacional dos serviços da plataforma. Regras de negócio e
comandos de validação podem variar; branches, CI, entrega e convenções de containers devem
permanecer alinhadas.

## Branches e ambientes

- `main` e `dev` são obrigatórias e devem ter a mesma árvore após cada sincronização de entrega.
- `main` representa produção; `dev` representa desenvolvimento/homologação.
- A diferença entre ambientes pertence ao Jenkins e ao `.env` externo ligado simbolicamente, não às
  regras de negócio versionadas.
- Serviços stateful que não podem manter duas sessões concorrentes validam e constroem `dev`, mas
  podem restringir o deploy automático à `main`.

## GitHub Actions

- Executa em `push` e `pull_request` para `main` e `dev`.
- Usa somente `permissions: contents: read`.
- Cancela uma execução antiga quando chega outra para a mesma referência.
- Roda a verificação completa do projeto, valida o Compose e, quando aplicável, constrói a imagem.
- Nunca recebe credenciais reais; a validação usa valores descartáveis.

## Jenkins

- Impede builds concorrentes do mesmo job e define timeout.
- Segue a ordem `Install`, `Verify`, `Compose`, `Container` e `Deploy`, omitindo somente etapas que
  não se aplicam ao serviço.
- Só produz artefato de entrega para `main` ou `dev`.
- Valida e constrói antes de interromper o container em execução.
- Deploy deve aguardar healthcheck e mostrar estado/logs em caso de falha.

## Docker e Compose

- Existem somente `docker-compose.yml` e `docker-compose.prod.yml`, ambos sem a chave obsoleta
  `version`.
- Configuração exclusiva de produção fica em `docker-compose.prod.yml`; o arquivo base não contém
  serviços de produção. Nenhum Compose usa `profiles`.
- O Compose usa nomes por função (`backend`, `frontend`, `web`, `worker`, `dispatcher`, `migrate` e
  `app` somente para aplicações inseparáveis). Produção usa o nome puro do repositório e
  desenvolvimento acrescenta `-dev`; o `.env` não sobrescreve esses nomes.
- `command` e `entrypoint` não ficam no Compose; os comandos executáveis são definidos no
  `Dockerfile`.
- O timezone padrão é `America/Sao_Paulo`.
- Imagens próprias usam `IMAGE_TAG` derivada do commit e labels uniformes de projeto, ambiente e
  versão; `latest` e número isolado do build não são entrega.
- O rollback local usa `sh scripts/rollback-compose.sh <prod|dev> <image-tag>`; retenção garantida
  entre hosts exige publicar as tags em um registry.
- Imagens próprias usam build multi-stage e runtime mínimo, sem dependências de desenvolvimento.
- O processo usa usuário sem privilégios quando a aplicação permite.
- Serviços definem `init`, `restart`, `stop_grace_period`, healthcheck e rotação de logs.
- Containers usam `no-new-privileges`, descarte de capabilities, filesystem somente leitura,
  `tmpfs`, limites e core dump desabilitado quando compatível com o runtime.
- Credenciais entram por Docker Secrets e variáveis `*_FILE`; não são gravadas na imagem nem
  impressas pelo pipeline.
- Volumes persistentes, portas e redes externas ficam explícitos. Um consumidor não entra em rede de
  banco se não acessa o banco diretamente.
- PostgreSQL e Redis são externos à aplicação. Host, porta, banco e usuário chegam pelo `.env`;
  somente as senhas entram nos containers por Docker Secrets e variáveis `*_FILE`. O projeto não
  cria esses serviços.
- Playwright, Puppeteer e Selenium são permanentes e sobem sem profiles ou flags de ativação.
- Consumidores usam a API central como E2E primário e Playwright local somente como fallback
  anterior à aceitação do job.

## Validação mínima

```bash
docker compose config --quiet
docker build --tag app:check .
```

Use também o comando de verificação completa documentado no `package.json`, `pyproject.toml`,
scripts ou README deste repositório.

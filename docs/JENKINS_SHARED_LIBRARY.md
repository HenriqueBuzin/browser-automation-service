# Biblioteca compartilhada do Jenkins

Os sete repositórios usam, nesta ordem, os estágios de topo `Install`, `Verify`,
`Compose`, `Container` e `Deploy`. Os `Jenkinsfile` permanecem autocontidos até
que a biblioteca seja registrada no controlador Jenkins, evitando interromper
os jobs existentes.

## Contrato proposto

- Nome global: `infra-pipeline`.
- Repositório dedicado: `jenkins-infra-library`.
- API inicial: `standardInfraPipeline(Map config)`.
- A biblioteca cuida apenas de branch, timeout, concorrência, link simbólico do
  `.env`, `COMPOSE_PROJECT_NAME`, `IMAGE_TAG`, validação dos dois Compose,
  healthcheck, diagnóstico e rollback.
- Cada repositório continua fornecendo seus comandos de instalação, verificação,
  build e deploy. Regras de negócio nunca entram na biblioteca.
- Produção usa o nome puro do repositório; desenvolvimento usa `<repo>-dev`.
- PostgreSQL e Redis são sempre externos e chegam por rede e configuração. A
  biblioteca não cria banco, cache, volumes ou containers para esses serviços.

## Ativação segura

1. Criar o repositório dedicado com `vars/standardInfraPipeline.groovy`.
2. Registrar `infra-pipeline` em **Manage Jenkins > System > Global Pipeline
   Libraries**, apontando para esse SCM.
3. Testar primeiro em um job de `dev`.
4. Migrar um repositório por vez e preservar os cinco estágios visíveis.
5. Só remover a implementação local depois que `main` e `dev` passarem no
   controlador real.

O endpoint do SCM, a credencial de leitura e a política de versão da biblioteca
precisam ser definidos no Jenkins antes da migração dos `Jenkinsfile`.

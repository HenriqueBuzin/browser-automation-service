pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }

    stages {
        stage('Install') {
            steps {
                echo 'Dependencias Node/npm sao instaladas no build multi-stage.'
            }
        }

        stage('Verify') {
            steps {
                sh 'docker build --target verify --tag browser-automation-service:verify .'
            }
        }

        stage('Compose') {
            when {
                anyOf {
                    branch 'main'
                    branch 'dev'
                }
            }
            steps {
                sh '''
                    set -eu
                    branch="${BRANCH_NAME#origin/}"
                    suffix=""
                    [ "$branch" = "dev" ] && suffix="-dev"
                    env_file="/root/projects/envs/browser-automation-service${suffix}.env"
                    test -f "$env_file"
                    ln -sfn "$env_file" .env
                    export COMPOSE_PROJECT_NAME="browser-automation-service${suffix}"
                    export IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
                    if [ "$branch" = "main" ]; then
                      docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
                    else
                      docker compose -f docker-compose.yml config --quiet
                    fi
                '''
            }
        }

        stage('Container') {
            when {
                anyOf {
                    branch 'main'
                    branch 'dev'
                }
            }
            parallel {
                stage('App image') {
                    steps {
                        sh 'docker build --target control --tag browser-automation-control:$(git rev-parse --short=12 HEAD) .'
                    }
                }
                stage('Worker image') {
                    steps {
                        sh 'docker build --target browser-worker --tag browser-automation-browser-worker:$(git rev-parse --short=12 HEAD) .'
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploy usa o ambiente externo ligado em .env e os dois arquivos Docker Compose padronizados.'
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'coverage/**', allowEmptyArchive: true
        }
    }
}

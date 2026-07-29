FROM node:24.18.0-bookworm AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TZ=America/Sao_Paulo
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM build AS verify

COPY . ./

RUN npm run check

FROM node:24.18.0-bookworm-slim AS control

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TZ=America/Sao_Paulo
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
RUN install -d -o node -g node /data/artifacts
COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/main.js"]

FROM node:24.18.0-bookworm AS browser-worker

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUPPETEER_FIREFOX_EXECUTABLE_PATH=/usr/local/bin/puppeteer-firefox

ARG PUPPETEER_FIREFOX_BUILD=stable_152.0.4
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev \
    && npx --no-install playwright install --with-deps chromium firefox webkit \
    && firefox_path="$(npx --no-install @puppeteer/browsers install firefox@${PUPPETEER_FIREFOX_BUILD} --path /ms-puppeteer --format '{{path}}')" \
    && ln -s "${firefox_path}" "${PUPPETEER_FIREFOX_EXECUTABLE_PATH}" \
    && npm cache clean --force
RUN install -d -o node -g node /data/artifacts

COPY --from=build --chown=node:node /app/dist ./dist

USER node
CMD ["node", "dist/main.js"]

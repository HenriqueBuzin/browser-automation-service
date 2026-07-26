FROM node:24.18.0-bookworm AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.18.0-bookworm-slim AS control

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/main.js"]

FROM mcr.microsoft.com/playwright:v1.62.0-noble AS browser-worker

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_FIREFOX_EXECUTABLE_PATH=/usr/local/bin/puppeteer-firefox

ARG PUPPETEER_FIREFOX_BUILD=stable_152.0.4
WORKDIR /app

COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev \
    && firefox_path="$(npx @puppeteer/browsers install firefox@${PUPPETEER_FIREFOX_BUILD} --path /ms-puppeteer --format '{{path}}')" \
    && ln -s "${firefox_path}" "${PUPPETEER_FIREFOX_EXECUTABLE_PATH}" \
    && npm cache clean --force

COPY --from=build --chown=pwuser:pwuser /app/dist ./dist

USER pwuser
CMD ["node", "dist/main.js"]

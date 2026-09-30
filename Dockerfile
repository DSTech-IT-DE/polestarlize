# syntax=docker/dockerfile:1

# --- Build the web app and the server (platform independent, so always on the build host) ---
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund

COPY . .
# The container serves the app from /, unlike the GitHub Pages build.
ARG GIT_COMMIT=unknown
ENV BASE_PATH=/ GIT_COMMIT=${GIT_COMMIT}
RUN npm run build

# --- Production dependencies of the server only (pure JavaScript) ---
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev --omit=optional --workspace=server --no-audit --no-fund \
 && npm cache clean --force

# --- Runtime ------------------------------------------------------------------
FROM node:24-alpine AS runtime
ARG VERSION=dev
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="polestarlize" \
      org.opencontainers.image.description="Analyse Polestar Journey Log exports, with an optional sync server" \
      org.opencontainers.image.source="https://github.com/DSTech-IT-DE/polestarlize" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"

# The runtime only needs node itself; drop the package managers that ship with the base image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir /data && chown node:node /data

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/main.js"]

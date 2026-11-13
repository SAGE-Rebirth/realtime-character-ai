# Platform API (Hono on Node). Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile .
FROM node:22-slim
RUN npm install -g pnpm@12.18.0 && useradd --create-home --uid 10001 app
WORKDIR /app

# Dependencies first, so editing source doesn't reinstall them.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @metaavatar/api...

COPY packages/protocol packages/protocol
COPY services/api services/api
RUN pnpm --filter @metaavatar/protocol build \
 && mkdir -p data assets/avatars && chown -R app:app data assets

USER app
ENV NODE_ENV=production API_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/services/api
CMD ["node_modules/.bin/tsx", "src/server.ts"]

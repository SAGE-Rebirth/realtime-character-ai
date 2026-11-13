# Studio (Next.js). Build from the repository root:
#   docker build -f infra/docker/studio.Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:8787 .
FROM node:22-slim AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/avatar-runtime/package.json packages/avatar-runtime/
COPY apps/studio/package.json apps/studio/
RUN pnpm install --frozen-lockfile --filter @metaavatar/studio...

COPY packages packages
COPY apps/studio apps/studio
# The API address is compiled into the browser code, so it is fixed when the image is built.
ARG NEXT_PUBLIC_API_URL=http://localhost:8787
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @metaavatar/protocol build && pnpm --filter @metaavatar/studio build

FROM node:22-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
USER app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/studio
CMD ["node_modules/.bin/next", "start", "-p", "3100"]

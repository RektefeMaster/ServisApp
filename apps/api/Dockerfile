# syntax=docker/dockerfile:1
FROM node:24.20.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/parent/package.json apps/parent/
COPY apps/crew/package.json apps/crew/
COPY apps/simulator/package.json apps/simulator/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @servisapp/api...
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @servisapp/api... build
RUN pnpm --filter @servisapp/api --prod --legacy deploy /out

FROM node:24.20.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/dist ./dist
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /repo/packages/db/migrations ./node_modules/@servisapp/db/migrations
USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]

# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/store/package.json packages/store/package.json

RUN npm ci

COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/cli/src apps/cli/src
COPY apps/cli/tsconfig.json apps/cli/tsconfig.json
COPY packages/protocol/src packages/protocol/src
COPY packages/protocol/tsconfig.json packages/protocol/tsconfig.json
COPY packages/store/src packages/store/src
COPY packages/store/tsconfig.json packages/store/tsconfig.json

RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    THREADLINE_HOST=0.0.0.0 \
    THREADLINE_PORT=3000 \
    THREADLINE_DATABASE=/data/threadline.sqlite

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build --chown=node:node /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build --chown=node:node /app/packages/store/package.json ./packages/store/package.json
COPY --from=build --chown=node:node /app/packages/store/dist ./packages/store/dist

RUN mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]

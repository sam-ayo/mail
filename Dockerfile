FROM node:24-alpine AS base
RUN corepack enable

FROM base AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile

FROM base AS production-dependencies-env
COPY ./package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY ./patches /app/patches
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod

FROM base AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
# mcp-use loads the built MCP server to check it, and env.server.ts needs these
# values when it loads. The build connects to nothing. The real values are runtime secrets.
RUN DATABASE_URL=postgresql://build:build@localhost/build SESSION_SECRET=build ENCRYPTION_KEY=build pnpm run build

FROM base
COPY ./package.json pnpm-lock.yaml /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
ENV NODE_ENV=production
# Start the server directly. "pnpm run start" makes corepack download pnpm at each start.
CMD ["node_modules/.bin/react-router-serve", "build/server/index.js"]

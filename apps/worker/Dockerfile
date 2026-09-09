# The worker paces outreach over hours and holds BullMQ schedulers, so it needs
# a process that stays up. It is not a serverless function.
FROM node:22-slim AS build

RUN corepack enable
WORKDIR /repo

# Manifests first, so a dependency install is cached across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents/package.json packages/agents/
COPY packages/linkedin/package.json packages/linkedin/
COPY packages/calendar/package.json packages/calendar/
COPY packages/crm/package.json packages/crm/
COPY packages/billing/package.json packages/billing/
COPY packages/email/package.json packages/email/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build --filter @le/worker...
RUN pnpm prune --prod

FROM node:22-slim AS runtime

RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=build /repo ./

# Runs unprivileged: this process holds decrypted OAuth tokens in memory.
USER node
EXPOSE 4000

# The health endpoint is unauthenticated on purpose so a load balancer can
# reach it; everything else needs the internal secret.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]

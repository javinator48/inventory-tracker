# Public demo image (DEMO_MODE=1): fictional data from demo/, a private sandbox per visitor,
# and rate-limited AI. Deployed to Cloud Run by scripts/deploy-demo.sh. Not for your real inventory.
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 DEMO_MODE=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build-demo.mjs && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DEMO_MODE=1 PORT=8080 \
    UPLOAD_DIR=/app/demo/uploads DEMO_SEED_DB=/app/demo/inventory.db DEMO_SESSION_DIR=/tmp/demo-sessions
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 8080
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "8080"]

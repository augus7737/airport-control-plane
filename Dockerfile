FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    openssh-client \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json

RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY README.md ./README.md

RUN mkdir -p /app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.js"]

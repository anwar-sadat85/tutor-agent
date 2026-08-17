# AgentCore Runtime requires arm64 architecture and a service listening on
# port 8080 implementing /ping and /invocations — both already handled by
# BedrockAgentCoreApp in main.ts.
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22-slim AS build

WORKDIR /app

# Skip Puppeteer's bundled Chromium download entirely — we install a real
# system Chromium via apt in the runtime stage instead (see below). The
# bundled Chrome-for-Testing binary on Linux ARM is a shell wrapper script
# with bash-specific syntax that fails under Debian's default dash shell.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc

# ---- Runtime stage ----
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22-slim

# Install a real system Chromium (a proper ELF binary, not a wrapper script)
# plus the shared libraries it needs on Debian-slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user, per AgentCore's container contract.
RUN groupadd --system agentcore && useradd --system --gid agentcore agentcore

WORKDIR /app

# Point Puppeteer at the apt-installed Chromium instead of its own download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Reuse node_modules from the build stage instead of running npm ci again
# here — faster, and there's no Puppeteer Chromium cache to worry about
# copying anymore since we skip that download entirely.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
RUN chown -R agentcore:agentcore /app

USER agentcore

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/main.js"]
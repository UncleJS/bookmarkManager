# =============================================================================
# Bookmark Manager API — Production image (Bun)
# =============================================================================
FROM docker.io/oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies — drizzle-kit (devDep) is required at runtime for migrations
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./
COPY drizzle.config.ts ./

EXPOSE 11650

# Run migrations then start the server
CMD ["sh", "-c", "bun run db:migrate && bun run src/server.ts"]

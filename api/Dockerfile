# =============================================================================
# Bookmark Manager API — Production image (Bun)
# =============================================================================
FROM oven/bun:1-alpine

RUN apk add --no-cache curl

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

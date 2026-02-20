# =============================================================================
# Bookmark Manager API — Production image (Bun)
# =============================================================================
FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies (production only)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./
COPY drizzle.config.ts ./

EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "bun run db:migrate && bun run src/server.ts"]

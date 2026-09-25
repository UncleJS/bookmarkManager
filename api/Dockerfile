# =============================================================================
# Bookmark Manager API — Production image (Bun)
# =============================================================================
FROM docker.io/oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends mariadb-client && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --create-home --home-dir /app app

WORKDIR /app

# Install only production dependencies for the runtime image.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./
COPY healthcheck.mjs ./
COPY docker-entrypoint.sh ./

RUN chmod 755 docker-entrypoint.sh && chown -R app:app /app

USER app

EXPOSE 11650

# Migrate, then replace the shell so Bun is PID 1
CMD ["./docker-entrypoint.sh"]

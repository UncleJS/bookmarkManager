// Simple healthcheck script — used by container HealthCmd
// Exits 0 if /health returns 2xx, exits 1 otherwise.
// Reads API_PORT from env (defaults to 11650) so dev (11660) and prod (11650) both work.
const port = process.env.API_PORT ?? "11650";
const r = await fetch(`http://localhost:${port}/health`).catch(() => null);
process.exit(r && r.ok ? 0 : 1);

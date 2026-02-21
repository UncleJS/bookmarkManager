// Simple healthcheck script — used by container HealthCmd
// Exits 0 if /health returns 2xx, exits 1 otherwise.
const r = await fetch("http://localhost:11650/health").catch(() => null);
process.exit(r && r.ok ? 0 : 1);

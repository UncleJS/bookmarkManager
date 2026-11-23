#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 UncleJS
set -eu
bun run src/db/migrate.ts
exec bun run src/server.ts

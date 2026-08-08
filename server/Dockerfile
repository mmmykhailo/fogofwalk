# Build from the REPOSITORY ROOT, not from server/ — the image needs `shared/`,
# which lives outside this directory:
#
#   docker build -f server/Dockerfile -t fogofwalk-server .
#   docker run -p 8787:8787 -v fogofwalk-data:/data --env-file server/.env \
#     fogofwalk-server
#
FROM oven/bun:1-alpine

WORKDIR /app/server

# Dependencies first, so a source edit does not re-resolve them.
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

# `~shared/*` resolves through server/tsconfig.json to ../shared — the layout
# inside the image has to match the repository's.
COPY shared /app/shared
COPY server/src ./src
COPY server/tsconfig.json ./

# Bun executes the TypeScript directly: no build step, no transpile output.
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787

# `bun` (uid 1000) ships with the base image; the volume has to be writable
# by it, and nothing here runs as root.
RUN mkdir -p /data && chown -R bun:bun /data /app
VOLUME ["/data"]
USER bun

EXPOSE 8787
CMD ["bun", "src/index.ts"]

# The cf-dam NAS agent. Build from the repository root:
#   docker build -f packages/agent/Dockerfile -t cf-dam-agent .
#   docker build -f packages/agent/Dockerfile --build-arg VIDEO=1 -t cf-dam-agent:video .
FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/agent/package.json packages/agent/
RUN npm ci --workspace @cf-dam/agent --include-workspace-root=false --ignore-scripts --no-audit --no-fund
# The agent shares one file with the Worker: the look-alike hash (no imports of its own).
COPY packages/api/src/catalog/dhash.ts packages/api/src/catalog/
COPY packages/agent/src packages/agent/src
RUN npx esbuild packages/agent/src/main.ts --bundle --platform=node --format=esm --target=node24 \
      --outfile=packages/agent/dist/agent.mjs --external:sharp --external:exiftool-vendored \
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM node:24-slim
# ExifTool is Perl; tini reaps ExifTool's child processes and passes signals on; LibRaw (1 MB) decodes
# RAWs whose embedded preview is too small; libheif's heif-convert, with its HEVC decoder, reads phones'
# HEIC (prebuilt sharp reads only AVIF). VIDEO=1 adds ffmpeg for video posters and contact sheets:
# about 465 MB more, so it is a separate image (…:0.1-video); without it, videos are indexed with no preview.
ARG VIDEO=0
RUN apt-get update && apt-get install -y --no-install-recommends perl tini libraw-bin libheif-examples $([ "$VIDEO" = 1 ] && echo ffmpeg) \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/agent/docker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /src/packages/agent/dist/agent.mjs ./
ENV DATA_DIR=/data PHOTOS_DIR=/photos PORT=8790 NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=60s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8790/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Runs as root so it can read shared folders whatever their ACLs. Photo folders are mounted
# read-only (:ro): the kernel stops any write to them, whoever the user.
ENTRYPOINT ["tini", "--"]
CMD ["node", "agent.mjs"]

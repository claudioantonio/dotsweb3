# syntax=docker.io/docker/dockerfile:1
# Cartesi Machine image for @dotsweb3/machine. Build context = repo root
# (see cartesi.toml), because the machine needs the protocol workspace and the
# locked dots-engine from the root package-lock.json.

ARG APT_UPDATE_SNAPSHOT=20260907T030400Z
ARG MACHINE_GUEST_TOOLS_VERSION=0.18.0
ARG MACHINE_GUEST_TOOLS_SHA256SUM=204d4260defd68e11b957ae1f1b511b6c2c74345c918748be06f592733b72dcd

FROM --platform=linux/riscv64 cartesi/node:22.14.0-noble-slim AS base
ARG APT_UPDATE_SNAPSHOT
ARG DEBIAN_FRONTEND=noninteractive
RUN <<EOF
set -eu
apt-get update
apt-get install -y --no-install-recommends ca-certificates
apt-get update --snapshot=${APT_UPDATE_SNAPSHOT}
EOF

# Pure-JS dependencies only, so the build stage can run on the host platform.
FROM --platform=$BUILDPLATFORM node:22.14.0-bookworm AS build-stage
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/machine/package.json packages/machine/
RUN npm ci --ignore-scripts -w @dotsweb3/protocol -w @dotsweb3/machine --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY packages/machine/tsconfig.json packages/machine/
COPY packages/machine/src packages/machine/src
RUN npm run build -w @dotsweb3/protocol && npm run build -w @dotsweb3/machine
# Production node_modules: dots-engine (pinned by the lockfile) + protocol symlink.
RUN rm -rf node_modules && npm ci --ignore-scripts --omit=dev -w @dotsweb3/protocol -w @dotsweb3/machine --include-workspace-root=false

FROM base
ARG APT_UPDATE_SNAPSHOT
ARG MACHINE_GUEST_TOOLS_VERSION
ARG MACHINE_GUEST_TOOLS_SHA256SUM
ADD --checksum=sha256:${MACHINE_GUEST_TOOLS_SHA256SUM} \
  https://github.com/cartesi/machine-guest-tools/releases/download/v${MACHINE_GUEST_TOOLS_VERSION}/machine-guest-tools_riscv64.deb \
  /tmp/machine-guest-tools_riscv64.deb
ARG DEBIAN_FRONTEND=noninteractive
RUN <<EOF
set -eu
apt-get install -y --no-install-recommends --snapshot=${APT_UPDATE_SNAPSHOT} \
  busybox-static \
  /tmp/machine-guest-tools_riscv64.deb
apt-get remove -y --purge ca-certificates
apt-get autoremove -y --purge
rm /tmp/machine-guest-tools_riscv64.deb
rm -rf /var/lib/apt/lists/* /var/log/* /var/cache/*
EOF
ENV PATH="/opt/cartesi/bin:${PATH}"

WORKDIR /opt/cartesi/dapp
COPY --from=build-stage /src/node_modules node_modules
COPY --from=build-stage /src/packages/protocol/package.json packages/protocol/package.json
COPY --from=build-stage /src/packages/protocol/dist packages/protocol/dist
COPY --from=build-stage /src/packages/machine/package.json packages/machine/package.json
COPY --from=build-stage /src/packages/machine/dist packages/machine/dist

ENV ROLLUP_HTTP_SERVER_URL="http://127.0.0.1:5004"
# Session owner (F2). Default = Anvil account #0, for local devnet only.
# Override for any real deployment.
ENV DOTS_OWNER="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

ENTRYPOINT ["rollup-init"]
CMD ["node", "packages/machine/dist/index.js"]

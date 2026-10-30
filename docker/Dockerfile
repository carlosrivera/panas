# syntax=docker/dockerfile:1
FROM ollama/ollama:0.40.12@sha256:20d1bbfbabe1c97ba4b16301f08a20d8484bcf77047742a3cb71c613d8e12d0b AS ollama
RUN rm -rf /usr/lib/ollama/cuda* /usr/lib/ollama/vulkan* /usr/lib/ollama/rocm*
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG SOURCE_COMMIT
ARG SOURCE_DIRTY=false
LABEL org.opencontainers.image.source="https://github.com/carlosrivera/panas" \
      org.opencontainers.image.revision=$SOURCE_COMMIT \
      io.panas.source-dirty=$SOURCE_DIRTY
COPY --from=ollama /bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama
COPY . /opt/panas/
RUN mkdir -p /state /ipc /run/panas /models && chown 10001:10001 /state /ipc /run/panas /models && chmod 700 /state /ipc /run/panas
ENV HOME=/tmp
USER 10001:10001
WORKDIR /opt/panas
ENTRYPOINT ["node","/opt/panas/apps/cli/src/container-entry.js"]

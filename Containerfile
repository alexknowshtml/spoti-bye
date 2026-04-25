FROM docker.io/oven/bun:1-debian

RUN apt-get update && apt-get install -y \
  python3 python3-pip unzip curl \
  && pip3 install yt-dlp --break-system-packages \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY src/ ./src/

ENTRYPOINT ["bun", "src/cli.ts"]
CMD []

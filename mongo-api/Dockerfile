FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]

FROM node:24-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate && pnpm build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]

FROM node:20-slim AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Install all dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY apps/api/ apps/api/
COPY packages/shared/ packages/shared/

# Build the API
WORKDIR /app/apps/api
RUN npm run build 2>/dev/null || echo "No build step — running TypeScript directly"

# Production stage
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/ .

WORKDIR /app/apps/api

# Railway sets PORT automatically
ENV NODE_ENV=production
EXPOSE 3001

CMD ["npx", "tsx", "src/index.ts"]

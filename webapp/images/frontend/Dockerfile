FROM node:22-alpine3.21 AS deps
WORKDIR /app
RUN apk upgrade --no-cache
COPY webapp/frontend/package.json ./
RUN npm install

FROM node:22-alpine3.21 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY webapp/frontend/ ./
RUN npm run build

FROM node:22-alpine3.21 AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk upgrade --no-cache \
    && addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

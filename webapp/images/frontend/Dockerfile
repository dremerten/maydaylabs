FROM node:22.22-alpine3.23 AS deps
WORKDIR /app
RUN apk upgrade --no-cache
COPY webapp/frontend/package.json ./
RUN npm install

FROM node:22.22-alpine3.23 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY webapp/frontend/ ./
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN npm run build

FROM node:22.22-alpine3.23 AS runner
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

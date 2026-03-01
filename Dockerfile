FROM node:20-alpine AS deps
WORKDIR /app
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
ENV http_proxy=${HTTP_PROXY}
ENV https_proxy=${HTTPS_PROXY}
ENV no_proxy=${NO_PROXY}
COPY package*.json ./
RUN set -eux; \
    npm config set registry "${NPM_REGISTRY}"; \
    npm config set fund false; \
    npm config set audit false; \
    npm config set progress false; \
    npm config set fetch-retries 5; \
    npm config set fetch-retry-factor 2; \
    npm config set fetch-retry-mintimeout 20000; \
    npm config set fetch-retry-maxtimeout 120000; \
    i=1; \
    while [ "$i" -le 3 ]; do \
      npm ci --no-audit --no-fund && break; \
      if [ "$i" -eq 3 ]; then exit 1; fi; \
      echo "npm ci failed (attempt $i). Retrying..."; \
      sleep $((i * 5)); \
      i=$((i + 1)); \
    done

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

# Single image: API + built SPA served from the same origin.
FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 SERVE_FRONTEND_DIR=/app/public STORAGE_DIR=/data/storage
WORKDIR /app/backend
COPY --from=backend /src/backend/node_modules ./node_modules
COPY --from=backend /src/backend/dist ./dist
COPY --from=backend /src/backend/drizzle ./drizzle
COPY --from=backend /src/backend/assets ./assets
COPY --from=backend /src/backend/package.json ./package.json
COPY --from=frontend /src/frontend/dist /app/public
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

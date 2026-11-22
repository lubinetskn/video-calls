FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/dist ./dist
ENV HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/calls.sqlite
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]

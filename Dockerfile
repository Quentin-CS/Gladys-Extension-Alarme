FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
RUN useradd --system --uid 10001 --create-home alarm
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
RUN mkdir -p /data && chown -R alarm:alarm /app /data
USER alarm
VOLUME ["/data"]
CMD ["node", "index.js"]

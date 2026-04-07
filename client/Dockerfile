FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build:ci

EXPOSE 4173

CMD ["node", "preview-server.mjs"]

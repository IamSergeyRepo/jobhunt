FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY *.mjs ./

CMD ["node", "server.mjs"]

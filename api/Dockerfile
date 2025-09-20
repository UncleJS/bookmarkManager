FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install --no-audit --no-fund
COPY src ./src
EXPOSE 3000
CMD ["npm", "start"]


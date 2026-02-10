FROM node:23-slim

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY tsconfig.json watch.js ./
COPY core/ core/
COPY tools/ tools/
COPY assistants/ assistants/
COPY types/ types/
COPY .env.example .env.example

# Install ts-node for runtime transpilation
RUN npm install ts-node typescript

EXPOSE 3011 8000

CMD ["npm", "start"]

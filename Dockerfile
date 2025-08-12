# Discord Voice Logger (Node.js)
FROM node:18-slim

RUN apt-get update && apt-get install -y \
  ffmpeg build-essential python3 pkg-config libopus-dev \
  && rm -rf /var/lib/apt/lists/*

# Work inside the bot folder
WORKDIR /app/bot

# Install deps first (better caching)
COPY bot/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy only the bot sources (don’t bake secrets)
COPY bot/. .

# Start
CMD ["npm", "start"]

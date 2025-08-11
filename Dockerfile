# Dockerfile for Discord Voice Logger (Node.js)

# Use a slim Node.js image as the base. Node 18 is an LTS release supported by discord.js.
FROM node:18-slim

# Install ffmpeg which is required for audio processing used by prism-media.
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if present) and install dependencies.
# Using package*.json matches both files without failing if the lock file is absent.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code into the container
COPY . .

# Copy environment file. In production you should mount your own .env.local via docker-compose.
COPY bot/.env.local .

# Start the bot. npm start runs `node index.js` as defined in package.json.
CMD ["npm", "start"]

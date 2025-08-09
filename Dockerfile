FROM python:3.11-slim

# Install required packages (like ffmpeg if needed for audio)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy requirements and install them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the src folder (lets our bot actually run
COPY src/ ./src/

# Copy the resources folder and other configs
COPY resources/ ./resources/
COPY .env.local .

# Command to run the bot
ENV PYTHONPATH=/app
CMD ["python", "src/echo_bot_application.py"]
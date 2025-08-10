Discord Voice Logger — Experimental Bot (Node.js)

This is an experimental Discord bot written in Node.js. It joins voice channels, records conversations, and can optionally upload recordings and speaker metadata to Amazon S3. The goal is to maintain conversational history, including the ability to review exact spoken words from different users.
🚀 Setup
✅ Prerequisites

    Node.js 18+ and npm

    Git

    Access to create a bot on the Discord Developer Portal

    Optional: Terraform and an AWS account if you want to provision the S3 bucket using the provided Terraform configuration

✅ Installing Dependencies

    Clone this repository:

git clone https://github.com/Calus14/debate-bro.git
cd debate-bro

Install Node dependencies:

    npm install

✅ Environment Variables

Create a file called .env in the project root with your default configuration. Optionally, you can create a .env.local file with overrides that take precedence over the values in .env.

A minimal .env might look like this:

# Discord bot token (from the Developer Portal)
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# How long silence (ms) constitutes the end of speech from a user (default 30000)
END_SILENCE_MS=30000

# Interval in minutes to split and flush recordings (default 5). If FLUSH_INTERVAL_MS is set, it overrides this.
FLUSH_INTERVAL_MINUTES=5

# Optional: Override the flush interval in milliseconds
# FLUSH_INTERVAL_MS=300000

# AWS credentials and S3 details (required only if uploading recordings to S3)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
S3_BUCKET_NAME=your_bucket_name

If a .env.local file exists, the bot will load it after .env and override any matching keys. This is useful for local development without modifying your base .env.

Notes:

    If FLUSH_INTERVAL_MS is set, it overrides FLUSH_INTERVAL_MINUTES.

    The AWS variables are only required if you want the bot to upload recordings to S3. Leaving them unset will disable S3 uploads.

✅ Running the Bot Locally

After installing dependencies and setting environment variables, you can start the bot locally with:

npm start

Invite the bot to a server (see below) and use the /join and /leave slash commands to start and stop recording. When the bot stops recording, it will return the paths to the audio and metadata files. If S3 uploads are configured, it will also upload those files to your bucket.
✅ Discord Bot Setup

    Go to the Discord Developer Portal and create a New Application.

    Under Bot, add a bot user and copy its Token.

    Under OAuth2 → URL Generator:

        Scopes:

            ✅ bot

            ✅ applications.commands

        Bot Permissions:

            ✅ View Channels

            ✅ Send Messages

            ✅ Read Message History

            ✅ Connect

            ✅ Speak

            ✅ Use Voice Activity

    Copy the generated OAuth2 URL and invite the bot to your server.

🐳 Running the Bot with Docker

A Dockerfile and docker-compose.yml are provided for convenience. On Linux you can use network_mode: "host" to allow UDP voice connections. On Windows/macOS, host networking is not supported, so it's recommended to run directly with Node.js instead of Docker.

To build and run the bot with Docker:

docker-compose build
docker-compose up

The container reads variables from .env and .env.local just like a local run. Set your AWS and Discord variables in those files.
☁️ S3 Storage and Terraform

The bot can optionally upload audio recordings and their speaker metadata to Amazon S3. To use this feature:

    Create an S3 bucket manually or with the provided Terraform configuration.

    Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET_NAME in your .env or .env.local file.

A simple Terraform configuration is included under the terraform/ directory. To provision a bucket using Terraform:

cd terraform
terraform init
terraform apply -var="bucket_name=your-bucket-name" -var="aws_region=us-east-1"

This will create a private S3 bucket named your-bucket-name. After the bucket is created, set S3_BUCKET_NAME=your-bucket-name in your environment.
📝 Commands

    /join — Starts recording in the voice channel you’re connected to.

    /leave — Stops recording and returns the recording paths. If S3 is configured, this will also upload recordings and metadata to your bucket.

📝 Notes

    This project is experimental — expect updates and behavior changes.

    Running inside Docker requires host networking (Linux only) due to Discord voice connections. On Windows/macOS, run the bot directly with Node.js.

    Real-time deploys will inject environment variables via Docker runtime; you should never commit your .env or .env.local files to Git.

🔧 Additional Configuration

You can adjust the bot's behavior with additional environment variables:

    END_SILENCE_MS — How long (in milliseconds) of silence denotes that a user has stopped speaking. Defaults to 30000 (30 seconds).

    FLUSH_INTERVAL_MINUTES or FLUSH_INTERVAL_MS — How often the bot flushes (splits) audio and metadata into new files. Defaults to 5 minutes. Set FLUSH_INTERVAL_MS to override with a value in milliseconds.

These values let you tune the recording segmentation and silence detection to your needs.
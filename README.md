
# Discord Voice Logger — Experimental Bot

This is an **experimental Discord bot** designed to join voice channels, record conversations, and provide playback of individual user audio.
The goal is to maintain conversational history, including the ability to review **exact spoken words** from different users.

---

## 🚀 Setup

### ✅ Prerequisites

* **Python 3.11+**
* [Git](https://git-scm.com/)
* Access to create a bot on the [Discord Developer Portal](https://discord.com/developers/applications)

---

### ✅ Virtual Environment Setup

1. Clone this repository

```bash
git clone <repo-url>
cd <repo-folder>
```

2. Create a virtual environment

```bash
python -m venv venv
```

3. Activate the environment

* On **Windows**:

```bash
venv\Scripts\activate
```

* On **macOS/Linux**:

```bash
source venv/bin/activate
```

4. Install dependencies

```bash
pip install -r requirements.txt
```

---

### ✅ Environment Variables

Create a file called `.env.local` in the project root with:

```
DISCORD_BOT_TOKEN=your_discord_bot_token_here
```

> ⚠️ **Do NOT commit `.env.local` to Git.**
> `.env` is reserved for Docker deployments and injected runtime variables.

---

## 🛠️ Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a **New Application**
3. Under **Bot**, add a bot user and copy its **Token**
4. Under **OAuth2 > URL Generator**:

    * Scopes:
        * ✅ `bot`
        * ✅ `applications.commands`
    * Bot Permissions:
        * ✅ View Channels
        * ✅ Send Messages
        * ✅ Read Message History
        * ✅ Connect
        * ✅ Speak
        * ✅ Use Voice Activity

5. Copy the generated OAuth2 URL and invite the bot to your server

---

## 🖥️ Running the Bot

```bash
python src/echo_bot_application.py
```

---

## 🎙️ Commands

* `/join` — Starts recording in the voice channel you’re connected to
* `/leave` — Stops recording and sends back individual user audio files

---

## 📝 Notes

* This project is experimental — expect updates and behavior changes
* It is **not recommended for production logging without further customization**
* Real-time deploys will inject environment variables via Docker runtime

---

## 🐳 Running the Bot with Docker

### ✅ Build the Docker Image

```bash
docker-compose build
```

### ✅ Run the Bot

```bash
docker-compose up
```

---

### ⚠️ Voice Connection Note — Docker Networking

Discord voice connections require outbound **UDP** access to Discord's media servers.
This can behave differently depending on your host OS:

| OS            | Recommended Network Mode         | Notes                                                               |
|---------------|-----------------------------------|---------------------------------------------------------------------|
| **Linux**    | `network_mode: "host"`            | Allows direct UDP connections (required for Discord voice bots)    |
| **Windows**  | ❌ Host networking not supported  | Voice connections may fail — recommended to run outside Docker     |
| **macOS**    | ❌ Host networking not supported  | Same as Windows — Docker Desktop limits UDP NAT traversal          |

---

### ✅ Example `docker-compose.yml` for Linux

```yaml
version: '3'
services:
  discord-bot:
    build: .
    env_file:
      - .env
    network_mode: "host"  # Needed for voice on Linux
```

---

### ✅ Running without Docker (Recommended on Windows/macOS)

```bash
python src/echo_bot_application.py
```

> On **Windows/macOS**, Docker may block Discord voice due to networking limitations.
> For best results, run directly with Python in a virtual environment.

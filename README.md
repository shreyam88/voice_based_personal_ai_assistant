# VoxAI

A local-first, bilingual voice assistant. The browser UI is React + Vite; the API is Express; responses come from Ollama running `llama3.2:latest`. No Python or paid AI API is used.

## Requirements

- Node.js 20.19+ (or 22.12+) and npm
- Ollama with `llama3.2:latest` available locally
- MongoDB is optional; it is only needed for accounts and cross-device conversation storage
- Chrome or Edge is recommended for browser speech recognition. Speech recognition support and processing are controlled by the browser; it may not be available in every browser or locale.

## Start locally

1. Install the project packages:

   ```powershell
   npm install
   ```

2. Create the local environment file and set a private JWT secret:

   ```powershell
   Copy-Item .env.example .env
   ```

   Edit `JWT_SECRET` in `.env` to a long random value. The default MongoDB URI is for a MongoDB service on this computer; leave `MONGODB_URI` unset if you only want guest chat.

3. Make sure Ollama is running and the model is installed:

   ```powershell
   ollama list
   ollama run llama3.2:latest
   ```

   The API expects Ollama at `http://127.0.0.1:11434` by default. Change `OLLAMA_URL` or `OLLAMA_MODEL` in `.env` if needed.

4. Start the frontend and API together:

   ```powershell
   npm run dev
   ```

   Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The Vite development server proxies `/api` requests to the Express API on port `3001`.

## Features

- Typed chat and browser speech input/output, with interrupt controls
- English/Hindi response selection and assistant, teacher, and interview-coach personalities
- Voice states for listening, thinking, and speaking; voice commands include “new chat”, “dark mode”, “light mode”, and “stop speaking”
- Conversation history saved in browser local storage for guest sessions
- Optional JWT accounts, bcrypt password hashes, and MongoDB conversation storage when MongoDB is configured
- Local Ollama health status and clear offline/error feedback

Chat context is sent to Ollama from the active conversation (up to 40 messages per request). Guest chat does not require MongoDB. Account creation and sign-in are unavailable until MongoDB connects.

## Commands

- `npm run dev` starts the API and Vite frontend in watch mode
- `npm run dev:api` starts only the Express API
- `npm run dev:web` starts only the Vite frontend
- `npm run build` typechecks the API and builds the frontend
- `npm run typecheck` typechecks the API
- `npm run lint` runs Oxlint
- `npm start` starts the API without the Vite development server

## Local security notes

The API binds to loopback and is intended for local development. Do not expose it to a network as-is. Before deployment, configure a strong `JWT_SECRET`, HTTPS, strict origin rules, request throttling, and a production-grade token/session storage strategy. Ollama inference is local; browser speech recognition behavior depends on your browser and its privacy settings.
# YouTube MCP Server

A Model Context Protocol (MCP) server that lets AI agents manage YouTube playlists through authenticated MCP tools and prompt templates. The project uses the Streamable HTTP transport and Google's official TypeScript SDK.

## Features

- OAuth2-authenticated access to the YouTube Data API v3 using your own Google account
- Playlist management tools (search, create, delete, add/remove videos, inspect playlists)
- Higher-level MCP prompts for playlist curation, summaries, and related-video discovery
- Designed for use with the MCP Inspector or any MCP-compatible client

## Prerequisites

- Node.js 22+ (see `.nvmrc` for the recommended version)
- A Google Cloud project with YouTube Data API v3 enabled
- Desktop OAuth client credentials (`credentials.json`) and a generated `token.json` for the YouTube account you want to control

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and adjust paths if needed:

   ```bash
   cp .env.example .env
   ```

3. Provide your OAuth credentials so the server can authenticate:

   ```
   config/credentials.json  # Google Cloud OAuth client
   config/token.json        # Generated refresh/access tokens
   ```

   These files are ignored by git. If you prefer not to mount files in production, you can set the following environment variables instead: `YOUTUBE_CREDENTIALS_JSON` and `YOUTUBE_TOKEN_JSON` (see Deployment notes below).

4. Run the interactive OAuth flow to populate `token.json`:

   ```bash
   npm run init:token
   ```

   This launches the Google consent screen in your browser (via `@google-cloud/local-auth`). Approve the requested scopes with the YouTube account you want the agent to control; the resulting refresh/access tokens are stored at `config/token.json`.

## Running

- **Development (hot reload):** `npm run dev`
- **Production build:** `npm run build`
- **Start compiled server:** `npm run start`
- **MCP Inspector:** `npm run inspector` (expects the dev server running at `http://localhost:3000/mcp`)

## Available MCP Tools

- `searchVideos(query, maxResults?)` – Find videos matching a query.
- `createPlaylist(title, description?, privacyStatus?)` – Create a playlist (private by default).
- `deletePlaylist(playlistId)` – Remove a playlist.
- `addVideoToPlaylist(playlistId, videoId, position?)` – Insert a video into a playlist.
- `removeVideoFromPlaylist(playlistId, videoId)` – Delete a playlist item by video ID.
- `getMyPlaylists(maxResults?)` – List your playlists.
- `getPlaylistItems(playlistId, maxResults?)` – Inspect videos within a playlist.

Each tool returns structured, human-readable text that you can wire directly into an MCP-aware AI assistant.

## Prompt Templates

- `curatePlaylist(theme, count)` – Provides candidate videos and instructions to craft a themed playlist.
- `summarizePlaylist(playlistId)` – Supplies playlist metadata and videos for natural-language summarization.
- `suggestSimilar(videoId, maxResults)` – Offers related-video candidates for recommendation tasks.

These prompts leverage YouTube data so your agent can keep the user in the loop while generating natural responses.

## Environment Variables

- `MCP_HTTP_PORT` – HTTP server port (default `3000`).
- `YOUTUBE_CREDENTIALS_PATH` – Path to the OAuth client credentials JSON (`config/credentials.json`).
- `YOUTUBE_TOKEN_PATH` – Path to the OAuth token JSON (`config/token.json`).
- `YOUTUBE_CREDENTIALS_JSON` / `YOUTUBE_TOKEN_JSON` – Optional inline JSON overrides. If set, the server skips reading from disk (and will not attempt to rewrite the token).

## Inspector Quickstart

1. Start the dev server: `npm run dev`
2. In another terminal, run: `npm run inspector`
3. Use the Inspector UI to invoke any tool or prompt (e.g., call `searchVideos` with a query or run the `summarizePlaylist` prompt with a playlist ID).

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [YouTube Data API v3](https://developers.google.com/youtube/v3)

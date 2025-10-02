import { NextRequest } from "next/server";
import { streamText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

const SYSTEM_PROMPT = `You are YouTube AI Agent, a helpful assistant that manages playlists using MCP tools.
- Prefer real actions via the provided tools when the user needs data or playlist changes.
- When adding several videos, use the bulk add tool to avoid repeated errors.
- When a tool returns data, summarize it clearly with bullet points or short paragraphs.
- If a tool reports no results, explain that calmly and suggest a next step.
- Only invent information if you clearly label it as a suggestion.`;

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const ensureEnv = () => {
  if (!process.env.MCP_SERVER_URL) {
    throw new Error("MCP_SERVER_URL is not configured.");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
};

const formatCallToolResult = (name: string, result: Awaited<ReturnType<Client["callTool"]>>): string => {
  if (result.isError) {
    const message = result.content?.map((entry) => (entry.type === "text" ? entry.text : JSON.stringify(entry))).join("\n") ?? "Unknown error";
    return `Tool ${name} returned an error: ${message}`;
  }

  if (result.structuredContent) {
    return typeof result.structuredContent === "string"
      ? result.structuredContent
      : JSON.stringify(result.structuredContent, null, 2);
  }

  const content = result.content
    ?.map((entry) => {
      if (entry.type === "text") {
        return entry.text;
      }
      if (entry.type === "resource") {
        return `${entry.mimeType ?? "resource"}: ${entry.uri}`;
      }
      return JSON.stringify(entry);
    })
    .join("\n");

  return content ?? `Tool ${name} executed with no textual response.`;
};

const formatPromptResult = (name: string, result: Awaited<ReturnType<Client["getPrompt"]>>): string => {
  const lines = result.messages.map((message) => {
    if (message.content.type === "text") {
      return `${message.role.toUpperCase()}: ${message.content.text}`;
    }
    return `${message.role.toUpperCase()}: ${JSON.stringify(message.content)}`;
  });

  return `Prompt ${name} returned the following guidance:\n${lines.join("\n")}`;
};

export async function POST(req: NextRequest) {
  ensureEnv();

  const { messages } = (await req.json()) as {
    messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string }>;
  };

  const client = new Client(
    {
      name: "youtube-mcp-web",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );

  const transport = new StreamableHTTPClientTransport(process.env.MCP_SERVER_URL!);

  try {
    await client.connect(transport);

  const callTool = async <T extends Record<string, unknown>>(name: string, args: T) => {
    try {
      const cleanArgs = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined && value !== ""),
      );
      const result = await client.callTool({ name, arguments: cleanArgs });
      return formatCallToolResult(name, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to execute tool ${name}: ${message}`;
    }
  };

  const callPrompt = async <T extends Record<string, unknown>>(name: string, args: T) => {
    try {
      const cleanArgs = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined && value !== ""),
      );
      const result = await client.getPrompt({ name, arguments: cleanArgs });
      return formatPromptResult(name, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to fetch prompt ${name}: ${message}`;
    }
  };

  const tools = {
    searchVideos: tool({
      description: "Search YouTube for videos matching a user query.",
      parameters: z.object({
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, maxResults }) => callTool("searchVideos", { query, maxResults }),
    }),
    createPlaylist: tool({
      description: "Create a new playlist in the authenticated YouTube account.",
      parameters: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        privacyStatus: z.enum(["private", "public", "unlisted"]).optional(),
      }),
      execute: async ({ title, description, privacyStatus }) =>
        callTool("createPlaylist", { title, description, privacyStatus }),
    }),
    deletePlaylist: tool({
      description: "Delete a playlist by its ID.",
      parameters: z.object({ playlistId: z.string().min(1) }),
      execute: async ({ playlistId }) => callTool("deletePlaylist", { playlistId }),
    }),
    addVideoToPlaylist: tool({
      description: "Add a video to a specific playlist.",
      parameters: z.object({
        playlistId: z.string().min(1),
        videoId: z.string().min(1),
        position: z.number().int().min(0).optional(),
      }),
      execute: async ({ playlistId, videoId, position }) =>
        callTool("addVideoToPlaylist", { playlistId, videoId, position }),
    }),
    addVideosToPlaylist: tool({
      description: "Add multiple videos to a playlist in order.",
      parameters: z.object({
        playlistId: z.string().min(1),
        videoIds: z.array(z.string().min(1)).min(1),
        startPosition: z.number().int().min(0).optional(),
      }),
      execute: async ({ playlistId, videoIds, startPosition }) =>
        callTool("addVideosToPlaylist", { playlistId, videoIds, startPosition }),
    }),
    removeVideoFromPlaylist: tool({
      description: "Remove a video from a playlist by video ID.",
      parameters: z.object({
        playlistId: z.string().min(1),
        videoId: z.string().min(1),
      }),
      execute: async ({ playlistId, videoId }) =>
        callTool("removeVideoFromPlaylist", { playlistId, videoId }),
    }),
    getMyPlaylists: tool({
      description: "List playlists owned by the authenticated user.",
      parameters: z.object({
        maxResults: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ maxResults }) => callTool("getMyPlaylists", { maxResults }),
    }),
    getPlaylistItems: tool({
      description: "List videos inside a playlist.",
      parameters: z.object({
        playlistId: z.string().min(1),
        maxResults: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ playlistId, maxResults }) =>
        callTool("getPlaylistItems", { playlistId, maxResults }),
    }),
    curatePlaylist: tool({
      description: "Fetch recommended guidance for building a themed playlist.",
      parameters: z.object({
        theme: z.string().min(1),
        count: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ theme, count }) =>
        callPrompt("curatePlaylist", { theme, count: count !== undefined ? count.toString() : undefined }),
    }),
    summarizePlaylist: tool({
      description: "Summarize the contents of a playlist in natural language.",
      parameters: z.object({
        playlistId: z.string().min(1),
      }),
      execute: async ({ playlistId }) => callPrompt("summarizePlaylist", { playlistId }),
    }),
  } as const;

    const response = await streamText({
      model: openai(DEFAULT_MODEL),
      messages,
      system: SYSTEM_PROMPT,
      temperature: 0.4,
      maxOutputTokens: 600,
      tools,
      toolChoice: "auto",
      maxSteps: 4,
    });

    return response.toDataStreamResponse();
  } catch (error) {
    console.error("/api/chat error", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

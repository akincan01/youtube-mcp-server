/**
 * Next.js API route for AI-powered YouTube playlist chat interface
 * Connects OpenAI GPT models with MCP YouTube tools via Vercel AI SDK
 */

import { NextRequest } from "next/server";
import { streamText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** System instructions for the AI assistant's behavior */
const SYSTEM_PROMPT = `You are YouTube AI Agent, a helpful assistant that manages playlists using MCP tools.
- Prefer real actions via the provided tools when the user needs data or playlist changes.
- When adding several videos, use the bulk add tool to avoid repeated errors.
- When a tool returns data, summarize it clearly with bullet points or short paragraphs.
- If a tool reports no results, explain that calmly and suggest a next step.
- Only invent information if you clearly label it as a suggestion.`;

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

/**
 * Validates required environment variables are set
 * @throws Error if MCP_SERVER_URL or OPENAI_API_KEY is missing
 */
const ensureEnv = () => {
  if (!process.env.MCP_SERVER_URL) {
    throw new Error("MCP_SERVER_URL is not configured.");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
};

/**
 * Formats MCP tool call results into human-readable text
 * Handles errors, structured content, text content, and resources
 */
const formatCallToolResult = (name: string, result: Awaited<ReturnType<Client["callTool"]>>): string => {
  // Handle error responses
  if (result.isError) {
    const content = result.content as any[];
    const message = content?.map((entry: any) => (entry.type === "text" ? entry.text : JSON.stringify(entry))).join("\n") ?? "Unknown error";
    return `Tool ${name} returned an error: ${message}`;
  }

  // Handle structured content (JSON responses)
  if (result.structuredContent) {
    return typeof result.structuredContent === "string"
      ? result.structuredContent
      : JSON.stringify(result.structuredContent, null, 2);
  }

  // Handle text/resource content
  const content = (result.content as any[])
    ?.map((entry: any) => {
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

/**
 * Formats MCP prompt results into readable guidance text
 * Extracts role and content from prompt messages
 */
const formatPromptResult = (name: string, result: Awaited<ReturnType<Client["getPrompt"]>>): string => {
  const lines = result.messages.map((message) => {
    if (message.content.type === "text") {
      return `${message.role.toUpperCase()}: ${message.content.text}`;
    }
    return `${message.role.toUpperCase()}: ${JSON.stringify(message.content)}`;
  });

  return `Prompt ${name} returned the following guidance:\n${lines.join("\n")}`;
};

/**
 * POST handler for chat API route
 * Streams AI responses with tool calling capabilities via MCP server
 * @param req - Next.js request containing chat messages
 * @returns Streamed text response with tool execution results
 */
export async function POST(req: NextRequest) {
  ensureEnv();

  const { messages } = (await req.json()) as {
    messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string }>;
  };

  // Create MCP client to connect to YouTube tools server
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

  // Connect to MCP server via Streamable HTTP transport
  const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_SERVER_URL!));

  try {
    await client.connect(transport);

  /**
   * Executes an MCP tool via the connected client
   * Filters out undefined/empty arguments before sending
   */
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

  /**
   * Fetches an MCP prompt (AI guidance template) via the connected client
   * Filters out undefined/empty arguments before sending
   */
  const callPrompt = async <T extends Record<string, unknown>>(name: string, args: T) => {
    try {
      const cleanArgs = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined && value !== ""),
      ) as Record<string, string>;
      const result = await client.getPrompt({ name, arguments: cleanArgs });
      return formatPromptResult(name, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to fetch prompt ${name}: ${message}`;
    }
  };

  // ==================== AI SDK TOOLS ====================
  // Each tool wraps an MCP tool from the YouTube server
  // These are exposed to the AI model for function calling

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
    // MCP Prompts exposed as tools (provide AI guidance, not direct actions)
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

    // Stream AI response with tool calling enabled
    const response = await streamText({
      model: openai(DEFAULT_MODEL) as any,
      messages,
      system: SYSTEM_PROMPT,
      temperature: 0.4, // Lower temperature for more consistent tool usage
      tools,
      toolChoice: "auto", // Let AI decide when to use tools
      maxSteps: 4, // Allow up to 4 tool calls per turn
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

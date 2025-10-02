import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult, type GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  getYouTubeClient,
  type PlaylistItemSummary,
  type PlaylistSummary,
  type VideoSummary,
} from "./youtube/youtubeClient.js";

const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const normalizeVideoId = (input: string): string => {
  const value = input.trim();
  if (YOUTUBE_VIDEO_ID_REGEX.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const queryId = url.searchParams.get("v");
    if (queryId && YOUTUBE_VIDEO_ID_REGEX.test(queryId)) {
      return queryId;
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (url.hostname.includes("youtu")) {
      if (url.hostname === "youtu.be" && segments[0] && YOUTUBE_VIDEO_ID_REGEX.test(segments[0])) {
        return segments[0];
      }

      if (segments.length >= 2 && segments[0] === "embed" && YOUTUBE_VIDEO_ID_REGEX.test(segments[1])) {
        return segments[1];
      }

      if (segments.length >= 2 && segments[0] === "shorts" && YOUTUBE_VIDEO_ID_REGEX.test(segments[1])) {
        return segments[1];
      }
    }
  } catch (error) {
    // Not a valid URL, fall through to pattern search.
  }

  const queryMatch = value.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (queryMatch) {
    return queryMatch[1];
  }

  const embedMatch = value.match(/embed\/([A-Za-z0-9_-]{11})/);
  if (embedMatch) {
    return embedMatch[1];
  }

  return value;
};

const videoIdSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const normalized = normalizeVideoId(value);
    if (!YOUTUBE_VIDEO_ID_REGEX.test(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide a valid YouTube video ID or URL.",
      });
      return z.NEVER;
    }
    return normalized;
  })
  .describe("Normalized YouTube video identifier");

const formatDate = (value?: string): string => {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().split("T")[0];
};

const formatVideos = (videos: VideoSummary[]): string => {
  if (videos.length === 0) {
    return "No videos found.";
  }

  return videos
    .map((video, index) => {
      const published = formatDate(video.publishedAt);
      const channel = video.channelTitle ?? "Unknown creator";
      const idLine = `\n   videoId: ${video.id}`;
      const thumbnailLine = video.thumbnailUrl ? `\n   Thumbnail: ${video.thumbnailUrl}` : "";
      return `${index + 1}. ${video.title} — ${channel} (${published})${idLine}\n   ${video.url}${thumbnailLine}`;
    })
    .join("\n");
};

const formatPlaylists = (playlists: PlaylistSummary[]): string => {
  if (playlists.length === 0) {
    return "No playlists found.";
  }

  return playlists
    .map((playlist, index) => {
      const privacy = playlist.privacyStatus ? ` [${playlist.privacyStatus}]` : "";
      return `${index + 1}. ${playlist.title}${privacy} — ${playlist.itemCount} items (ID: ${playlist.id})`;
    })
    .join("\n");
};

const formatPlaylistItems = (items: PlaylistItemSummary[]): string => {
  if (items.length === 0) {
    return "No videos found in playlist.";
  }

  return items
    .map((item, index) => {
      const published = formatDate(item.publishedAt);
      const channel = item.channelTitle ?? "Unknown creator";
      const thumbnailLine = item.thumbnailUrl ? `\n   Thumbnail: ${item.thumbnailUrl}` : "";
      return `${index + 1}. ${item.title} — ${channel} (${published}) [videoId=${item.videoId}]${thumbnailLine}`;
    })
    .join("\n");
};

export const getServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "youtube-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );

  server.tool(
    "searchVideos",
    "Search YouTube for videos matching a query.",
    {
      query: z.string().min(1).describe("Text to search on YouTube"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of videos to return (default 10)"),
    },
    async ({ query, maxResults }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const videos = await client.searchVideos(query, maxResults);

      return {
        content: [
          {
            type: "text",
            text: `Search results for "${query}":\n${formatVideos(videos)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "createPlaylist",
    "Create a new playlist in the authenticated YouTube account.",
    {
      title: z.string().min(1).describe("Playlist title"),
      description: z.string().optional().describe("Playlist description"),
      privacyStatus: z
        .enum(["private", "public", "unlisted"])
        .default("private")
        .describe("Playlist visibility (default private)"),
    },
    async ({ title, description, privacyStatus }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const playlist = await client.createPlaylist({
        title,
        description,
        privacyStatus: privacyStatus ?? "private",
      });

      return {
        content: [
          {
            type: "text",
            text: `Created playlist "${playlist.title}" (ID: ${playlist.id}) — ${playlist.itemCount} items, visibility ${playlist.privacyStatus}.`,
          },
        ],
      };
    },
  );

  server.tool(
    "deletePlaylist",
    "Delete a playlist by ID.",
    {
      playlistId: z.string().min(1).describe("ID of the playlist to delete"),
    },
    async ({ playlistId }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      await client.deletePlaylist(playlistId);

      return {
        content: [
          {
            type: "text",
            text: `Deleted playlist ${playlistId}.`,
          },
        ],
      };
    },
  );

  server.tool(
    "addVideoToPlaylist",
    "Add a video to a playlist.",
    {
      playlistId: z.string().min(1).describe("Target playlist ID"),
      videoId: videoIdSchema.describe("YouTube video ID or URL"),
      position: z.number().int().min(0).optional().describe("Insert position (0-based)"),
    },
    async ({ playlistId, videoId, position }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const item = await client.addVideoToPlaylist({ playlistId, videoId, position });

      return {
        content: [
          {
            type: "text",
            text: `Added video ${item.videoId} to playlist ${item.playlistId} at position ${item.position}. (Item ID: ${item.id})`,
          },
        ],
      };
    },
  );

  server.tool(
    "addVideosToPlaylist",
    "Add multiple videos to a playlist in sequence.",
    {
      playlistId: z.string().min(1).describe("Target playlist ID"),
      videoIds: z
        .array(videoIdSchema.describe("YouTube video ID or URL"))
        .min(1)
        .describe("List of video IDs or URLs to add"),
      startPosition: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Optional starting insert position (0-based)"),
    },
    async ({ playlistId, videoIds, startPosition }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const lines: string[] = [];

      let currentPosition = startPosition;

      for (const [index, videoId] of videoIds.entries()) {
        try {
          const item = await client.addVideoToPlaylist({
            playlistId,
            videoId,
            position: currentPosition,
          });

          lines.push(
            `✅ Added ${item.title || videoId} (videoId=${item.videoId}) at position ${item.position}.`,
          );

          if (typeof currentPosition === "number") {
            currentPosition += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lines.push(`❌ Failed to add ${videoId}: ${message}`);
        }

        // Space operations slightly if Google throttles rapid inserts
        if (index < videoIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "removeVideoFromPlaylist",
    "Remove a video from a playlist by video ID.",
    {
      playlistId: z.string().min(1).describe("Playlist ID"),
      videoId: videoIdSchema.describe("Video ID or URL to remove"),
    },
    async ({ playlistId, videoId }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const removedItem = await client.removeVideoFromPlaylist({ playlistId, videoId });

      const text = removedItem
        ? `Removed video ${videoId} from playlist ${playlistId}. (Item ID: ${removedItem.id})`
        : `No video with ID ${videoId} found in playlist ${playlistId}.`;

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  );

  server.tool(
    "getMyPlaylists",
    "List playlists owned by the authenticated user.",
    {
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of playlists to return (default 10)"),
    },
    async ({ maxResults }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const playlists = await client.listMyPlaylists(maxResults);

      return {
        content: [
          {
            type: "text",
            text: formatPlaylists(playlists),
          },
        ],
      };
    },
  );

  server.tool(
    "getPlaylistItems",
    "Get videos inside a playlist.",
    {
      playlistId: z.string().min(1).describe("Target playlist ID"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of videos to return (default 10)"),
    },
    async ({ playlistId, maxResults }): Promise<CallToolResult> => {
      const client = await getYouTubeClient();
      const items = await client.listPlaylistItems({ playlistId, maxResults });

      return {
        content: [
          {
            type: "text",
            text: formatPlaylistItems(items),
          },
        ],
      };
    },
  );

  server.prompt(
    "curatePlaylist",
    "Generate instructions for curating a themed playlist.",
    {
      theme: z.string().min(1).describe("High-level theme or vibe for the playlist"),
      count: z
        .string()
        .regex(/^[0-9]+$/, "Count must be a positive integer")
        .optional()
        .describe("Number of videos to recommend"),
    },
    async ({ theme, count }): Promise<GetPromptResult> => {
      const parsedCount = count ? Number.parseInt(count, 10) : Number.NaN;
      const targetCount = Number.isNaN(parsedCount)
        ? 5
        : Math.min(Math.max(parsedCount, 1), 25);
      const client = await getYouTubeClient();
      const candidates = await client.searchVideos(theme, Math.min(targetCount * 3, 25));

      const candidateText = formatVideos(candidates);

      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: "You are a creative music and video curator crafting thoughtful YouTube playlists.",
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: `Create a YouTube playlist with ${targetCount} videos that celebrates the theme: "${theme}".\nUse the candidate videos below as inspiration (you may choose others if you know better options).\n${candidateText}`,
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "summarizePlaylist",
    "Provide a natural language summary of a playlist's content.",
    {
      playlistId: z.string().min(1).describe("Playlist ID to summarize"),
    },
    async ({ playlistId }): Promise<GetPromptResult> => {
      const client = await getYouTubeClient();
      const [metadata, items] = await Promise.all([
        client.getPlaylistMetadata(playlistId),
        client.listPlaylistItems({ playlistId, maxResults: 25 }),
      ]);

      if (!metadata) {
        throw new Error(`Playlist ${playlistId} not found.`);
      }

      const videosText = formatPlaylistItems(items);

      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: "You summarize YouTube playlists for quick human digestion.",
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: `Write a concise yet vivid summary of the playlist "${metadata.title}" (ID: ${metadata.id}).\nDescription: ${metadata.description ?? "(no description provided)"}\nTotal items: ${metadata.itemCount}\nVideos:\n${videosText}`,
            },
          },
        ],
      };
    },
  );

  /*
   * Temporarily disabled until related-video prompt stabilizes.
   * server.prompt(
   *   "suggestSimilar",
   *   "Suggest related videos for a given YouTube video.",
   *   {
   *     videoId: videoIdSchema.describe("Seed video ID or URL"),
   *     maxResults: z
   *       .string()
   *       .regex(/^[0-9]+$/, "Max results must be a positive integer")
   *       .optional()
   *       .describe("Number of related videos to propose"),
   *   },
   *   async ({ videoId, maxResults }): Promise<GetPromptResult> => {
   *     const client = await getYouTubeClient();
   *     const parsedMax = maxResults ? Number.parseInt(maxResults, 10) : Number.NaN;
   *     const targetMax = Number.isNaN(parsedMax)
   *       ? 5
   *       : Math.min(Math.max(parsedMax, 1), 25);
   *     const [seed, related] = await Promise.all([
   *       client.getVideoDetails(videoId),
   *       client.listRelatedVideos(videoId, targetMax * 2),
   *     ]);
   *
   *     if (!seed) {
   *       throw new Error(`Video ${videoId} not found.`);
   *     }
   *
   *     const relatedText = formatVideos(related);
   *
   *     return {
   *       messages: [
   *         {
   *           role: "assistant",
   *           content: {
   *             type: "text",
   *             text: "You recommend YouTube videos with excellent taste and context awareness.",
   *           },
   *         },
   *         {
   *           role: "user",
   *           content: {
   *             type: "text",
   *             text: `Suggest ${targetMax} YouTube videos similar to "${seed.title}" (${seed.url}).\nUse the related video candidates below for inspiration.\n${relatedText}`,
   *           },
   *         },
   *       ],
   *     };
   *   },
   * );
   */

  return server;
};

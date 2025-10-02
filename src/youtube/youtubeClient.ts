/**
 * YouTube Data API v3 client wrapper
 * Provides simplified methods for video search, playlist management, and data retrieval
 */

import type { youtube_v3 } from "googleapis";
import { google } from "googleapis";

import { getOAuthClient } from "./auth.js";

/** Simplified video metadata returned by search and detail methods */
export interface VideoSummary {
  id: string;
  title: string;
  description?: string;
  channelTitle?: string;
  publishedAt?: string;
  url: string;
  thumbnailUrl?: string;
}

/** Simplified playlist metadata with video count and privacy status */
export interface PlaylistSummary {
  id: string;
  title: string;
  description?: string;
  itemCount: number;
  privacyStatus?: string;
}

/** Represents a single video within a playlist with position information */
export interface PlaylistItemSummary {
  id: string;
  playlistId: string;
  position: number;
  videoId: string;
  title: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
}

/** YouTube API enforces a maximum of 50 results per request */
const MAX_RESULTS_LIMIT = 50;

/**
 * Clamps maxResults to valid range (1-50) with default of 10
 */
const clampMaxResults = (maxResults?: number): number => {
  if (!maxResults || Number.isNaN(maxResults)) {
    return 10;
  }

  return Math.min(Math.max(1, Math.floor(maxResults)), MAX_RESULTS_LIMIT);
};

/**
 * Selects best available thumbnail URL from YouTube's size variants
 * Priority: maxres > standard > high > medium > default
 */
const selectThumbnail = (thumbnails?: youtube_v3.Schema$ThumbnailDetails | null): string | undefined => {
  if (!thumbnails) {
    return undefined;
  }

  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    undefined
  );
};

/**
 * YouTube Data API v3 client with simplified methods for common operations
 * Use getYouTubeClient() factory function to obtain a singleton instance
 */
export class YouTubeClient {
  private readonly service: youtube_v3.Youtube;

  private constructor(service: youtube_v3.Youtube) {
    this.service = service;
  }

  /**
   * Creates a new YouTubeClient with authenticated API access
   * Uses OAuth2 credentials from auth module
   */
  static async create(): Promise<YouTubeClient> {
    const auth = await getOAuthClient();
    const service = google.youtube({ version: "v3", auth });
    return new YouTubeClient(service);
  }

  /**
   * Searches YouTube for videos matching a query
   * @param query - Search terms
   * @param maxResults - Number of results to return (1-50, default 10)
   * @returns Array of video summaries ordered by relevance
   */
  async searchVideos(query: string, maxResults?: number): Promise<VideoSummary[]> {
    const response = await this.service.search.list({
      q: query,
      part: ["snippet"],
      maxResults: clampMaxResults(maxResults),
      type: ["video"],
      order: "relevance",
    });

    const items = response.data.items ?? [];
    const results: VideoSummary[] = [];

    for (const item of items) {
      const id = item.id?.videoId;
      const title = item.snippet?.title;
      if (!id || !title) {
        continue;
      }

      results.push({
        id,
        title,
        description: item.snippet?.description ?? undefined,
        channelTitle: item.snippet?.channelTitle ?? undefined,
        publishedAt: item.snippet?.publishedAt ?? undefined,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: selectThumbnail(item.snippet?.thumbnails),
      });
    }

    return results;
  }

  /**
   * Creates a new playlist in the authenticated user's account
   * @param title - Playlist name
   * @param description - Optional playlist description
   * @param privacyStatus - Visibility setting (default: private)
   * @returns Created playlist summary with ID
   */
  async createPlaylist({
    title,
    description,
    privacyStatus = "private",
  }: {
    title: string;
    description?: string;
    privacyStatus?: "private" | "public" | "unlisted";
  }): Promise<PlaylistSummary> {
    const response = await this.service.playlists.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
        },
        status: {
          privacyStatus,
        },
      },
    });

    const playlist = response.data;

    if (!playlist.id || !playlist.snippet) {
      throw new Error("Failed to create playlist");
    }

    return {
      id: playlist.id,
      title: playlist.snippet.title ?? title,
      description: playlist.snippet.description ?? description,
      itemCount: playlist.contentDetails?.itemCount ?? 0,
      privacyStatus: playlist.status?.privacyStatus ?? privacyStatus,
    };
  }

  /**
   * Permanently deletes a playlist
   * @param playlistId - ID of playlist to delete
   */
  async deletePlaylist(playlistId: string): Promise<void> {
    await this.service.playlists.delete({ id: playlistId });
  }

  /**
   * Adds a video to a playlist at specified position
   * @param playlistId - Target playlist ID
   * @param videoId - YouTube video ID to add
   * @param position - Optional 0-based position (defaults to end of playlist)
   * @returns Playlist item summary with assigned position
   */
  async addVideoToPlaylist({
    playlistId,
    videoId,
    position,
  }: {
    playlistId: string;
    videoId: string;
    position?: number;
  }): Promise<PlaylistItemSummary> {
    const response = await this.service.playlistItems.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          playlistId,
          position,
          resourceId: {
            kind: "youtube#video",
            videoId,
          },
        },
      },
    });

    const item = response.data;

    if (!item.id || !item.snippet || !item.snippet.resourceId?.videoId) {
      throw new Error("Failed to add video to playlist");
    }

    return {
      id: item.id,
      playlistId: item.snippet.playlistId ?? playlistId,
      position: item.snippet.position ?? 0,
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title ?? "",
      channelTitle: item.snippet.videoOwnerChannelTitle ?? undefined,
      publishedAt: item.snippet.publishedAt ?? undefined,
      thumbnailUrl: selectThumbnail(item.snippet.thumbnails),
    };
  }

  /**
   * Removes a video from a playlist by video ID
   * @param playlistId - Target playlist ID
   * @param videoId - YouTube video ID to remove
   * @returns Removed playlist item summary, or null if not found
   */
  async removeVideoFromPlaylist({
    playlistId,
    videoId,
  }: {
    playlistId: string;
    videoId: string;
  }): Promise<PlaylistItemSummary | null> {
    const items = await this.listPlaylistItems({ playlistId, maxResults: MAX_RESULTS_LIMIT });
    const match = items.find((item) => item.videoId === videoId);

    if (!match) {
      return null;
    }

    await this.service.playlistItems.delete({ id: match.id });
    return match;
  }

  /**
   * Lists all playlists owned by the authenticated user
   * @param maxResults - Number of playlists to return (1-50, default 10)
   * @returns Array of playlist summaries with video counts
   */
  async listMyPlaylists(maxResults?: number): Promise<PlaylistSummary[]> {
    const response = await this.service.playlists.list({
      part: ["snippet", "status", "contentDetails"],
      mine: true,
      maxResults: clampMaxResults(maxResults),
    });

    const playlists: PlaylistSummary[] = [];

    for (const item of response.data.items ?? []) {
      if (!item.id || !item.snippet?.title) {
        continue;
      }

      playlists.push({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description ?? undefined,
        itemCount: item.contentDetails?.itemCount ?? 0,
        privacyStatus: item.status?.privacyStatus ?? undefined,
      });
    }

    return playlists;
  }

  /**
   * Lists videos in a playlist with position information
   * @param playlistId - Target playlist ID
   * @param maxResults - Number of items to return (1-50, default 10)
   * @returns Array of playlist items in order
   */
  async listPlaylistItems({
    playlistId,
    maxResults,
  }: {
    playlistId: string;
    maxResults?: number;
  }): Promise<PlaylistItemSummary[]> {
    const response = await this.service.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId,
      maxResults: clampMaxResults(maxResults),
    });

    const items: PlaylistItemSummary[] = [];

    for (const item of response.data.items ?? []) {
      const id = item.id;
      const videoId = item.snippet?.resourceId?.videoId;
      if (!id || !videoId) {
        continue;
      }

      items.push({
        id,
        playlistId,
        position: item.snippet?.position ?? 0,
        videoId,
        title: item.snippet?.title ?? "",
        channelTitle: item.snippet?.videoOwnerChannelTitle ?? undefined,
        publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? undefined,
        thumbnailUrl: selectThumbnail(item.snippet?.thumbnails),
      });
    }

    return items;
  }

  /**
   * Retrieves playlist metadata without fetching all items
   * @param playlistId - Target playlist ID
   * @returns Playlist summary or null if not found
   */
  async getPlaylistMetadata(playlistId: string): Promise<PlaylistSummary | null> {
    const response = await this.service.playlists.list({
      part: ["snippet", "status", "contentDetails"],
      id: [playlistId],
      maxResults: 1,
    });

    const item = response.data.items?.[0];
    if (!item || !item.id) {
      return null;
    }

    return {
      id: item.id,
      title: item.snippet?.title ?? "",
      description: item.snippet?.description ?? undefined,
      itemCount: item.contentDetails?.itemCount ?? 0,
      privacyStatus: item.status?.privacyStatus ?? undefined,
    };
  }

  /**
   * Finds videos related to a given video
   * @param videoId - Seed video ID to find related content
   * @param maxResults - Number of related videos to return (1-50, default 10)
   * @returns Array of related video summaries
   */
  async listRelatedVideos(videoId: string, maxResults?: number): Promise<VideoSummary[]> {
    const response = await this.service.search.list({
      part: ["snippet"],
      type: ["video"],
      maxResults: clampMaxResults(maxResults),
      relatedToVideoId: videoId,
      // Type assertion needed - googleapis types don't include relatedToVideoId
    } as unknown as youtube_v3.Params$Resource$Search$List);

    const items = response.data.items ?? [];
    const results: VideoSummary[] = [];

    for (const item of items) {
      const id = item.id?.videoId;
      const title = item.snippet?.title;
      if (!id || !title) {
        continue;
      }

      results.push({
        id,
        title,
        description: item.snippet?.description ?? undefined,
        channelTitle: item.snippet?.channelTitle ?? undefined,
        publishedAt: item.snippet?.publishedAt ?? undefined,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnailUrl: selectThumbnail(item.snippet?.thumbnails),
      });
    }

    return results;
  }

  /**
   * Retrieves detailed metadata for a specific video
   * @param videoId - YouTube video ID
   * @returns Video summary or null if not found
   */
  async getVideoDetails(videoId: string): Promise<VideoSummary | null> {
    const response = await this.service.videos.list({
      part: ["snippet"],
      id: [videoId],
    });

    const video = response.data.items?.[0];
    if (!video?.id || !video.snippet?.title) {
      return null;
    }

    return {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description ?? undefined,
      channelTitle: video.snippet.channelTitle ?? undefined,
      publishedAt: video.snippet.publishedAt ?? undefined,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      thumbnailUrl: selectThumbnail(video.snippet.thumbnails),
    };
  }
}

/** Singleton cache for YouTube client instance */
let clientPromise: Promise<YouTubeClient> | null = null;

/**
 * Returns a singleton YouTubeClient instance
 * Creates the client on first call, then returns cached instance
 * Resets cache on error to allow retry on next call
 */
export const getYouTubeClient = (): Promise<YouTubeClient> => {
  if (!clientPromise) {
    clientPromise = YouTubeClient.create().catch((error) => {
      clientPromise = null; // Reset cache on error to allow retry
      throw error;
    });
  }

  return clientPromise;
};

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google, type Auth } from "googleapis";

import { config } from "../config.js";

const TOKEN_WRITE_SPACES = 2;

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

interface OAuthConfigFile {
  installed?: OAuthClientConfig;
  web?: OAuthClientConfig;
}

let cachedClient: Promise<Auth.OAuth2Client> | null = null;

const resolvePath = (value: string): string => {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(process.cwd(), value);
};

const loadCredentials = async (): Promise<OAuthClientConfig> => {
  const envOverride = process.env.YOUTUBE_CREDENTIALS_JSON;
  const rawCredentials = envOverride
    ? envOverride
    : await readFile(resolvePath(config.YOUTUBE_CREDENTIALS_PATH), "utf-8");
  const parsed: OAuthConfigFile = JSON.parse(rawCredentials);
  const credentials = parsed.installed ?? parsed.web;

  if (!credentials) {
    throw new Error("Invalid OAuth credentials file: missing 'installed' or 'web' configuration.");
  }

  if (!credentials.client_id || !credentials.client_secret || credentials.redirect_uris.length === 0) {
    throw new Error("Invalid OAuth credentials file: missing client details or redirect URIs.");
  }

  return credentials;
};

const loadToken = async (): Promise<Auth.Credentials> => {
  const envOverride = process.env.YOUTUBE_TOKEN_JSON;
  if (envOverride) {
    return JSON.parse(envOverride) as Auth.Credentials;
  }

  const tokenPath = resolvePath(config.YOUTUBE_TOKEN_PATH);
  const rawToken = await readFile(tokenPath, "utf-8");
  return JSON.parse(rawToken) as Auth.Credentials;
};

const persistUpdatedToken = async (token: Auth.Credentials): Promise<void> => {
  if (process.env.YOUTUBE_TOKEN_JSON) {
    console.warn("Detected YOUTUBE_TOKEN_JSON environment variable; skipping token persistence to avoid diverging from deployment secret.");
    return;
  }

  const tokenPath = resolvePath(config.YOUTUBE_TOKEN_PATH);

  try {
    const existingContents = await readFile(tokenPath, "utf-8");
    const existing = JSON.parse(existingContents) as Auth.Credentials;
    const mergedToken = { ...existing, ...token } satisfies Auth.Credentials;
    await writeFile(tokenPath, JSON.stringify(mergedToken, null, TOKEN_WRITE_SPACES), "utf-8");
  } catch (error) {
    // If reading fails (e.g. file missing), fallback to writing provided token as-is.
    await writeFile(tokenPath, JSON.stringify(token, null, TOKEN_WRITE_SPACES), "utf-8");
  }
};

const createOAuthClient = async (): Promise<Auth.OAuth2Client> => {
  const credentials = await loadCredentials();
  const token = await loadToken();

  const client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uris[0],
  );

  client.setCredentials(token);

  client.on("tokens", async (tokens: Auth.Credentials) => {
    if (Object.keys(tokens).length === 0) {
      return;
    }

    try {
      await persistUpdatedToken(tokens);
    } catch (error) {
      console.warn("Failed to persist refreshed OAuth token", error);
    }
  });

  return client;
};

export const getOAuthClient = (): Promise<Auth.OAuth2Client> => {
  if (!cachedClient) {
    cachedClient = createOAuthClient().catch((error) => {
      cachedClient = null;
      throw error;
    });
  }

  return cachedClient;
};

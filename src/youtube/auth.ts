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

const buildCredentialsFromEnv = (): OAuthClientConfig | null => {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const redirectUrisRaw = process.env.YOUTUBE_REDIRECT_URIS?.trim();

  if (!clientId || !clientSecret || !redirectUrisRaw) {
    return null;
  }

  const redirectUris = redirectUrisRaw
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);

  if (redirectUris.length === 0) {
    throw new Error("YOUTUBE_REDIRECT_URIS must contain at least one URI (comma-separated).");
  }

  return {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
  } satisfies OAuthClientConfig;
};

const loadCredentials = async (): Promise<OAuthClientConfig> => {
  const envCredentials = buildCredentialsFromEnv();
  if (envCredentials) {
    return envCredentials;
  }

  const envOverride = process.env.YOUTUBE_CREDENTIALS_JSON?.trim();
  const rawCredentials = envOverride
    ? envOverride
    : await readFile(resolvePath(config.YOUTUBE_CREDENTIALS_PATH), "utf-8");

  let parsed: OAuthConfigFile;
  try {
    parsed = JSON.parse(rawCredentials) as OAuthConfigFile;
  } catch (error) {
    throw new Error("Failed to parse YouTube OAuth credentials JSON. Ensure the value is valid JSON.");
  }
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
  const envAccessToken = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
  const envRefreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  const envTokenType = process.env.YOUTUBE_TOKEN_TYPE?.trim();
  const envScope = process.env.YOUTUBE_SCOPE?.trim();
  const envExpiry = process.env.YOUTUBE_TOKEN_EXPIRY?.trim();

  if (envAccessToken && envRefreshToken) {
    const expiryDate = envExpiry ? Number.parseInt(envExpiry, 10) : undefined;
    if (envExpiry && Number.isNaN(expiryDate)) {
      throw new Error("YOUTUBE_TOKEN_EXPIRY must be a numeric timestamp (milliseconds since epoch).");
    }

    return {
      access_token: envAccessToken,
      refresh_token: envRefreshToken,
      scope: envScope,
      token_type: envTokenType,
      expiry_date: expiryDate,
    } satisfies Auth.Credentials;
  }

  const envOverride = process.env.YOUTUBE_TOKEN_JSON?.trim();
  if (envOverride) {
    try {
      return JSON.parse(envOverride) as Auth.Credentials;
    } catch (error) {
      throw new Error("Failed to parse YouTube OAuth token JSON. Ensure the value is valid JSON.");
    }
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

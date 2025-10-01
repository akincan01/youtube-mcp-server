import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { authenticate } from "@google-cloud/local-auth";

import { config } from "../src/config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtubepartner-channel-audit",
];

const resolvePath = (value: string): string => {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(process.cwd(), value);
};

const ensureDirectory = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
};

const main = async (): Promise<void> => {
  const credentialsPath = resolvePath(config.YOUTUBE_CREDENTIALS_PATH);
  const tokenPath = resolvePath(config.YOUTUBE_TOKEN_PATH);

  const client = await authenticate({
    keyfilePath: credentialsPath,
    scopes: SCOPES,
  });

  if (!client.credentials) {
    throw new Error("Authentication succeeded but no credentials were returned.");
  }

  await ensureDirectory(tokenPath);
  await writeFile(tokenPath, JSON.stringify(client.credentials, null, 2));

  console.log(`Saved tokens to ${tokenPath}`);
};

main().catch((error) => {
  console.error("Failed to initialize YouTube OAuth token:", error);
  process.exit(1);
});

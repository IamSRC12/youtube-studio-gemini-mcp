import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { google } from 'googleapis';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Returns an OAuth2 client configured with environment variables
 * and automatically refreshes expired access tokens.
 */
export function getOAuth2Client() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing YouTube API credentials in environment variables (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "http://localhost:3000/oauth2callback"
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

/**
 * Constructs and configures the Model Context Protocol (MCP) server with YouTube Studio tools.
 */
export function createYouTubeMcpServer() {
  const server = new McpServer({
    name: "YouTube Studio MCP Server",
    version: "1.0.0",
  });

  // Tool 1: get_channel_stats
  server.tool(
    "get_channel_stats",
    "Retrieves statistics for the authenticated YouTube channel, including subscriber count, total view count, and video count.",
    {},
    async () => {
      try {
        const auth = getOAuth2Client();
        const youtube = google.youtube({ version: "v3", auth });
        const res = await youtube.channels.list({
          mine: true,
          part: ["statistics", "snippet"],
        });

        const channel = res.data.items?.[0];
        if (!channel) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "No channel found for authenticated account." }),
              },
            ],
          };
        }

        const stats = channel.statistics;
        const snippet = channel.snippet;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  channelId: channel.id,
                  title: snippet?.title,
                  subscriberCount: stats?.subscriberCount,
                  viewCount: stats?.viewCount,
                  videoCount: stats?.videoCount,
                  hiddenSubscriberCount: stats?.hiddenSubscriberCount,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message || String(err) }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: fetch_unanswered_comments
  server.tool(
    "fetch_unanswered_comments",
    "Fetches recent top-level comments on the authenticated channel's videos that currently have zero replies.",
    {
      maxResults: z
        .number()
        .optional()
        .describe("Maximum number of comment threads to fetch (default: 10, max: 50)"),
    },
    async ({ maxResults = 10 }) => {
      try {
        const auth = getOAuth2Client();
        const youtube = google.youtube({ version: "v3", auth });

        const channelRes = await youtube.channels.list({ mine: true, part: ["id"] });
        const channelId = channelRes.data.items?.[0]?.id;
        if (!channelId) {
          throw new Error("No channel found for authenticated user.");
        }

        const response = await youtube.commentThreads.list({
          allThreadsRelatedToChannelId: channelId,
          part: ["snippet", "replies"],
          maxResults: Math.min(maxResults, 50),
          order: "time",
        });

        const threads = response.data.items || [];
        const unanswered = threads
          .filter((t: any) => {
            const totalReplies = t.snippet?.totalReplyCount || 0;
            return totalReplies === 0;
          })
          .map((t: any) => {
            const topComment = t.snippet?.topLevelComment?.snippet;
            return {
              threadId: t.id,
              commentId: t.snippet?.topLevelComment?.id || t.id,
              videoId: t.snippet?.videoId,
              authorName: topComment?.authorDisplayName,
              authorChannelUrl: topComment?.authorChannelUrl,
              textDisplay: topComment?.textDisplay,
              textOriginal: topComment?.textOriginal,
              publishedAt: topComment?.publishedAt,
              likeCount: topComment?.likeCount,
            };
          });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  totalChecked: threads.length,
                  unansweredCount: unanswered.length,
                  comments: unanswered,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message || String(err) }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: post_comment_reply
  server.tool(
    "post_comment_reply",
    "Publishes a text reply to a specific top-level YouTube comment ID.",
    {
      commentId: z.string().describe("The parent comment ID to reply to"),
      text: z.string().describe("The text content of the reply"),
    },
    async ({ commentId, text }) => {
      try {
        const auth = getOAuth2Client();
        const youtube = google.youtube({ version: "v3", auth });

        const response = await youtube.comments.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              parentId: commentId,
              textOriginal: text,
            },
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  replyId: response.data.id,
                  parentId: commentId,
                  publishedAt: response.data.snippet?.publishedAt,
                  textOriginal: response.data.snippet?.textOriginal,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message || String(err) }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Starts Express HTTP Server serving MCP over Server-Sent Events (SSE).
 */
export function startExpressMcpServer(port: number = 3000) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const mcpServer = createYouTubeMcpServer();
  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (req: Request, res: Response) => {
    console.log('[MCP Server] Client connected via SSE transport');
    const transport = new SSEServerTransport('/message', res);
    transports.set(transport.sessionId, transport);

    req.on('close', () => {
      console.log(`[MCP Server] SSE Session disconnected: ${transport.sessionId}`);
      transports.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
  });

  app.post('/message', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessionId ? transports.get(sessionId) : Array.from(transports.values())[0];

    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: "Session not found or expired. Connect to /sse first." });
    }
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: "ok", activeSessions: transports.size });
  });

  const server = app.listen(port, () => {
    console.log(`[MCP Server] YouTube MCP Express Server running on http://localhost:${port}`);
    console.log(`[MCP Server] SSE Endpoint: http://localhost:${port}/sse`);
  });

  return { app, server };
}

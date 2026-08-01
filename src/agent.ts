import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Exponential backoff helper for rate limits (HTTP 429 / RESOURCE_EXHAUSTED).
 */
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelayMs = 2000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('Quota exceeded');

      if (isRateLimit && attempt <= maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Gemini Agent] ⚠️ Rate limit encountered. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Connects to the YouTube MCP server either via SSE (built-in or remote URL) or Stdio (external binary).
 */
export async function createMcpClient(serverUrlOrMode: string) {
  const mode = process.env.MCP_MODE || 'sse';

  if (mode === 'stdio') {
    const command = process.env.EXTERNAL_MCP_COMMAND || 'npx';
    const argsStr = process.env.EXTERNAL_MCP_ARGS || '-y,@pauling-ai/youtube-mcp-server';
    const args = argsStr.split(',');

    console.log(`[MCP Client] Connecting via Stdio Transport: ${command} ${args.join(' ')}`);
    const transport = new StdioClientTransport({ command, args });
    const client = new Client(
      { name: 'gemini-youtube-agent', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  } else {
    console.log(`[MCP Client] Connecting via SSE Transport to: ${serverUrlOrMode}`);
    const transport = new SSEClientTransport(new URL(serverUrlOrMode));
    const client = new Client(
      { name: 'gemini-youtube-agent', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  }
}

/**
 * Converts MCP Tool schemas into Gemini API compatible function declarations.
 */
export function convertMcpToolsToGemini(mcpTools: any[]) {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: tool.inputSchema || { type: 'OBJECT', properties: {} },
  }));
}

/**
 * Main Gemini YouTube Studio Automation Logic Loop.
 */
export async function runAutomationLoop(mcpClient: Client) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-2.5-flash';

  console.log('[Gemini Agent] 🔍 Discovering available MCP tools...');
  const toolsResult = await mcpClient.listTools();
  const mcpTools = toolsResult.tools || [];
  console.log(`[Gemini Agent] Found ${mcpTools.length} tools:`, mcpTools.map((t) => t.name).join(', '));

  const geminiTools = convertMcpToolsToGemini(mcpTools);

  console.log('\n======================================================');
  console.log('🚀 Starting YouTube Studio Automation Loop');
  console.log('======================================================\n');

  // Step 1: Fetch channel stats
  try {
    if (mcpTools.some((t) => t.name === 'get_channel_stats')) {
      console.log('[Gemini Agent] Fetching channel statistics via MCP...');
      const statsRes = await mcpClient.callTool({ name: 'get_channel_stats', arguments: {} });
      console.log('[Gemini Agent] Channel Stats Result:\n', (statsRes as any).content?.[0]?.text);
    }
  } catch (err: any) {
    console.warn('[Gemini Agent] Could not fetch channel stats:', err.message);
  }

  // Step 2: Fetch unanswered comments
  console.log('\n[Gemini Agent] Fetching unanswered comments...');
  let fetchResult: any;
  try {
    fetchResult = await mcpClient.callTool({
      name: 'fetch_unanswered_comments',
      arguments: { maxResults: 10 },
    });
  } catch (err: any) {
    console.error('[Gemini Agent] Failed to fetch unanswered comments:', err.message);
    return;
  }

  const resultText = (fetchResult as any).content?.[0]?.text || '{}';
  let parsed: any = {};
  try {
    parsed = JSON.parse(resultText);
  } catch (_) {
    parsed = { comments: [] };
  }

  const comments: any[] = parsed.comments || [];
  console.log(`[Gemini Agent] Found ${comments.length} unanswered comment(s) to process.`);

  if (comments.length === 0) {
    console.log('[Gemini Agent] ✨ All comments have been answered! Standing by.');
    return;
  }

  // Step 3: Process each comment through Gemini for Sentiment Analysis & Reply Generation
  for (const comment of comments) {
    console.log(`\n------------------------------------------------------`);
    console.log(`💬 Processing Comment ID: ${comment.commentId}`);
    console.log(`👤 Author: ${comment.authorName}`);
    console.log(`📝 Text: "${comment.textOriginal || comment.textDisplay}"`);
    console.log(`------------------------------------------------------`);

    const prompt = `You are a warm, professional, and engaging YouTube Creator Assistant.
Analyze the following YouTube video comment and generate an appropriate reply:

Comment Author: ${comment.authorName}
Comment Content: "${comment.textOriginal || comment.textDisplay}"

Tasks:
1. Determine the overall sentiment (Positive, Neutral, Negative, Question).
2. Write a helpful, friendly, and concise response (max 2-3 sentences). Keep it natural and engaging.
3. Call the "post_comment_reply" tool using commentId: "${comment.commentId}" and the generated reply text.

Available Tools Schema:
${JSON.stringify(geminiTools, null, 2)}
`;

    try {
      const response = await callWithRetry(async () => {
        return await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            tools: [{ functionDeclarations: geminiTools }],
          },
        });
      });

      console.log('[Gemini Agent] 🧠 Model Response Generated.');
      const candidate = response.candidates?.[0];
      const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall);

      if (functionCalls && functionCalls.length > 0) {
        for (const part of functionCalls) {
          const call = (part as any).functionCall;
          console.log(`[Gemini Agent] 🛠️ Executing Tool Call: ${call.name}`);
          console.log(`[Gemini Agent] Tool Arguments:`, JSON.stringify(call.args, null, 2));

          const toolExecution = await mcpClient.callTool({
            name: call.name,
            arguments: call.args,
          });

          console.log('[Gemini Agent] ✅ Tool Execution Output:\n', (toolExecution as any).content?.[0]?.text);
        }
      } else {
        const replyText = response.text || '';
        console.log('[Gemini Agent] 💬 Model output (non-tool call):\n', replyText);

        // Fallback tool call if tool wasn't triggered automatically
        console.log(`[Gemini Agent] Executing post_comment_reply tool fallback for ${comment.commentId}...`);
        const fallbackExec = await mcpClient.callTool({
          name: 'post_comment_reply',
          arguments: {
            commentId: comment.commentId,
            text: replyText.trim(),
          },
        });
        console.log('[Gemini Agent] ✅ Fallback Reply Executed:\n', (fallbackExec as any).content?.[0]?.text);
      }
    } catch (err: any) {
      console.error(`[Gemini Agent] Error processing comment ${comment.commentId}:`, err.message || err);
    }
  }

  console.log('\n======================================================');
  console.log('✅ YouTube Studio Automation Run Finished');
  console.log('======================================================\n');
}

import dotenv from 'dotenv';
import { startExpressMcpServer } from './mcp_server.js';
import { setupNgrokTunnel } from './tunnel.js';
import { createMcpClient, runAutomationLoop } from './agent.ts';

dotenv.config();

async function main() {
  console.log('======================================================');
  console.log('🤖 Google Gemini AI + YouTube MCP + Ngrok Engine');
  console.log('======================================================\n');

  const port = Number(process.env.PORT) || 3000;
  const mode = process.env.MCP_MODE || 'sse';

  let mcpEndpoint = `http://localhost:${port}/sse`;

  if (mode === 'sse') {
    // 1. Launch local Express MCP server over SSE
    console.log('[Init] Launching embedded Express MCP Server...');
    startExpressMcpServer(port);

    // Give server a moment to bind
    await new Promise((res) => setTimeout(res, 1000));

    // 2. Launch Ngrok Tunnel Gateway
    try {
      const publicUrl = await setupNgrokTunnel(port);
      mcpEndpoint = `${publicUrl}/sse`;
    } catch (err: any) {
      console.warn('[Init] Ngrok tunnel startup failed. Falling back to local SSE endpoint:', mcpEndpoint);
    }
  } else {
    console.log('[Init] Running in External Stdio MCP mode...');
  }

  // 3. Connect MCP Client & Execute Gemini Automation Agent
  try {
    const mcpClient = await createMcpClient(mcpEndpoint);
    console.log('[Init] Connected to YouTube MCP Server successfully.');

    // Execute automation workflow
    await runAutomationLoop(mcpClient);
  } catch (err: any) {
    console.error('[Init] Error during execution:', err.message || err);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

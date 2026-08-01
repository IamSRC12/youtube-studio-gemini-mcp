import ngrok from 'ngrok';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Initializes a programmatic Ngrok HTTPS tunnel to expose the local MCP Express server port remotely.
 * @param port Local server port to forward
 * @returns Public HTTPS URL of the established Ngrok tunnel
 */
export async function setupNgrokTunnel(port: number = 3000): Promise<string> {
  const authtoken = process.env.NGROK_AUTHTOKEN;

  const options: ngrok.Ngrok.Options = {
    addr: port,
    proto: 'http',
  };

  if (authtoken) {
    options.authtoken = authtoken;
  } else {
    console.warn('[Ngrok] Notice: NGROK_AUTHTOKEN is not set. Launching tunnel in anonymous mode.');
  }

  try {
    console.log(`[Ngrok] Connecting HTTPS gateway to local port ${port}...`);
    const publicUrl = await ngrok.connect(options);

    console.log(`[Ngrok] ✅ Tunnel Active!`);
    console.log(`[Ngrok] 🌐 Public Gateway URL : ${publicUrl}`);
    console.log(`[Ngrok] 📡 Remote SSE Endpoint : ${publicUrl}/sse`);
    console.log(`[Ngrok] 💬 Remote Msg Endpoint : ${publicUrl}/message`);

    // Register cleanup hook
    process.on('SIGINT', async () => {
      console.log('[Ngrok] Disconnecting tunnel...');
      try {
        await ngrok.disconnect();
        await ngrok.kill();
      } catch (_) {}
    });

    return publicUrl;
  } catch (err: any) {
    console.error('[Ngrok] Failed to establish tunnel:', err.message || String(err));
    throw err;
  }
}

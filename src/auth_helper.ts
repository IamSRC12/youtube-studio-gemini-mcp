import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const port = Number(process.env.PORT) || 3000;
const redirectUri = `http://localhost:${port}/oauth2callback`;

if (!clientId || !clientSecret) {
  console.error("❌ Error: YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be configured in .env first.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const scopes = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent'
});

const app = express();

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.send("Authorization code missing.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n======================================================');
    console.log('🎉 SUCCESS! YouTube OAuth2 Refresh Token Obtained!');
    console.log('======================================================\n');
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('Copy the token above into your .env file as YOUTUBE_REFRESH_TOKEN.\n');

    res.send(`
      <html>
        <body style="font-family: system-ui, sans-serif; padding: 2.5rem; background: #090d16; color: #f1f5f9; text-align: center;">
          <div style="max-width: 600px; margin: 0 auto; background: #131c2e; padding: 2rem; border-radius: 12px; border: 1px solid #1e293b;">
            <h2 style="color: #4ade80;">🎉 Authentication Successful!</h2>
            <p style="color: #94a3b8;">Your YouTube Refresh Token has been generated and outputted in your terminal console.</p>
            <div style="background: #090d16; padding: 1rem; border-radius: 8px; word-break: break-all; color: #38bdf8; font-family: monospace; text-align: left;">
              YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}
            </div>
            <p style="color: #64748b; margin-top: 1.5rem;">You may close this browser window now.</p>
          </div>
        </body>
      </html>
    `);

    setTimeout(() => {
      process.exit(0);
    }, 2000);
  } catch (err: any) {
    console.error("Error retrieving tokens:", err.message);
    res.status(500).send("Error exchanging authorization code for tokens.");
  }
});

app.listen(port, () => {
  console.log('\n======================================================');
  console.log('🔑 YouTube OAuth2 Token Setup Wizard');
  console.log('======================================================\n');
  console.log('1. Open the following authorization link in your web browser:\n');
  console.log(`🔗 ${authUrl}\n`);
  console.log(`2. Log in with your YouTube account and grant permissions.`);
  console.log(`3. The browser will redirect back to http://localhost:${port}/oauth2callback and display your token.\n`);
});

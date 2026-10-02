import fs from 'fs/promises';
import { google } from 'googleapis';
import readline from 'readline';

async function startWatching() {
    try {
        // 1. Read your credentials.json manually
        const content = await fs.readFile('credentials.json', 'utf8');
        const credentials = JSON.parse(content);
        // Desktop apps usually nest these under 'installed'
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

        // 2. Create the raw OAuth2 client
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        // 3. Generate the Authentication URL
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent', // Forces a new refresh token
            scope: ['https://www.googleapis.com/auth/gmail.readonly'],
        });

        console.log('\n--- MANUAL AUTHENTICATION REQUIRED ---');
        console.log('1. Open this exact URL in your browser:\n');
        console.log(authUrl);
        console.log('\n--------------------------------------\n');

        // 4. Open a prompt to accept the code
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('2. After approving, you will be redirected to a broken localhost page.\n   Copy the "code=" part from the URL bar and paste it here: ', async (code) => {
            rl.close();
            
            try {
                // 5. Exchange the code for actual tokens and force them into the client
                const { tokens } = await oAuth2Client.getToken(decodeURIComponent(code));
                oAuth2Client.setCredentials(tokens);
                console.log('\n[Tokens acquired successfully! Triggering webhook...]');

                // 6. Execute the watch method
                const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
                
                const res = await gmail.users.watch({
                    userId: 'me',
                    requestBody: {
                        labelIds: ['INBOX'],
                        // Replace YOUR_PROJECT_ID with your actual GCP Project ID
                        topicName: 'projects/ai-job-applier-488220/topics/gmail-events' 
                    }
                });
                
                console.log('\n✅ SUCCESS! Webhook is active.', res.data);
            } catch (err) {
                console.error('\n❌ Error getting tokens or setting watch:', err.message);
            }
        });
    } catch (error) {
        console.error('❌ Error loading credentials.json. Make sure the file exists:', error.message);
    }
}

startWatching();
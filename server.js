import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis'; // 1. Added googleapis import
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// 2. Initialize the Google Auth Client using your uploaded credentials
const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json', // Ensure this file is on Render
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
});
const gmail = google.gmail({ version: 'v1', auth });

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <XjSbxHGLKIRQF6kl97M14GtVz836kTOtn5r3-7dxJ8E>
                <meta name="google-site-verification" content="XjSbxHGLKIRQF6kl97M14GtVz836kTOtn5r3-7dxJ8E" />
            </head>
            <body>Render Webhook Server Online</body>
        </html>
    `);
});

app.post('/api/gmail-webhook', async (req, res) => {
    try {
        res.status(200).send('OK');

        if (!req.body || !req.body.message) return;

        const decodedData = Buffer.from(req.body.message.data, 'base64').toString('utf-8');
        const { historyId, emailAddress } = JSON.parse(decodedData);
        
        console.log(`\n[RENDER] Webhook caught! Email: ${emailAddress} | historyId: ${historyId}`);

        // 3. LIVE GMAIL FETCH LOGIC
        // Query the history to find the specific message ID that triggered the webhook
        const historyResponse = await gmail.users.history.list({
            userId: emailAddress,
            startHistoryId: historyId,
        });

        const histories = historyResponse.data.history;
        if (!histories || histories.length === 0) return;

        // Grab the most recent message ID from the history payload
        let messageId = null;
        for (const record of histories) {
            if (record.messagesAdded) {
                messageId = record.messagesAdded[0].message.id;
                break;
            }
        }

        if (!messageId) return;

        // Download the full email data using the message ID
        const messageResponse = await gmail.users.messages.get({
            userId: emailAddress,
            id: messageId,
            format: 'full' 
        });

        // 4. DECODE THE BASE64 EMAIL BODY
        const payload = messageResponse.data.payload;
        let encodedBody = '';
        
        // Gmail structures emails differently depending on if they have attachments or rich text
        if (payload.parts && payload.parts.length > 0) {
            encodedBody = payload.parts[0].body.data || '';
        } else {
            encodedBody = payload.body.data || '';
        }

        // Convert Google's base64url format into plain text
        const rawEmailText = Buffer.from(encodedBody, 'base64url').toString('utf-8');
        
        console.log(`\n--- Fetched Real Email Content ---\n${rawEmailText}`);

        // 5. ROUTE THE LIVE TEXT TO GEMINI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `
            Analyze the following email and extract the interview date, time, and company name.
            Format the output strictly as a JSON object with keys: "company", "date", "time".
            
            Email Content:
            ${rawEmailText}
        `;

        const result = await model.generateContent(prompt);
        console.log("\n--- Gemini AI Extraction Result ---");
        console.log(result.response.text());

    } catch (error) {
        console.error("Webhook or Parsing Error:", error);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
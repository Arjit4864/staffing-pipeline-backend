import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// 1. Google Domain Verification Bypass
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <meta name="google-site-verification" content="XjSbxHGLKIRQF6kl97M14GtVz836kTOtn5r3-7dxJ8E" />
                <meta name="google-site-verification" content="YOUR_COPIED_CODE_HERE" />
            </head>
            <body>Render Webhook Server Online</body>
        </html>
    `);
});

// 2. Gmail Webhook & Gemini Parser
app.post('/api/gmail-webhook', async (req, res) => {
    try {
        // Acknowledge receipt immediately so Google stops retrying
        res.status(200).send('OK');

        if (!req.body || !req.body.message) {
            console.log("Empty payload received.");
            return;
        }

        // Decode the base64 payload from Google Pub/Sub
        const decodedData = Buffer.from(req.body.message.data, 'base64').toString('utf-8');
        const { historyId, emailAddress } = JSON.parse(decodedData);
        
        console.log(`\n[RENDER] Webhook caught! Email: ${emailAddress} | historyId: ${historyId}`);

        // Mock string to verify extraction pipeline until Gmail API fetch call is linked
        const rawEmailText = "Subject: Interview Invitation\nHi Arjit, we would like to schedule your technical interview for next Tuesday at 2:00 PM EST.";

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `
            Analyze the following email and extract the interview date, time, and company name.
            Format the output strictly as a JSON object with keys: "company", "date", "time".
            
            Email Content:
            ${rawEmailText}
        `;

        const result = await model.generateContent(prompt);
        console.log("--- Gemini AI Extraction Result ---");
        console.log(result.response.text());

    } catch (error) {
        console.error("Webhook or Parsing Error:", error);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
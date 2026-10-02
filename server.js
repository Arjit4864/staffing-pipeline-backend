const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
// Essential for receiving Google's JSON webhook payload
app.use(express.json()); 

// 1. THE GOOGLE DOMAIN VERIFICATION BYPASS
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <meta name="google-site-verification" content="XjSbxHGLKIRQF6kl97M14GtVz836kTOtn5r3-7dxJ8E" />
                <meta name="google-site-verification" content="YOUR_COPIED_CODE_HERE" />
            </head>
            <body>Render Webhook Server Online</body>
        </html>
    `);
});

// 2. THE GMAIL WEBHOOK & GEMINI PARSER
app.post('/api/gmail-webhook', async (req, res) => {
    try {
        // Acknowledge receipt immediately so Google stops pinging
        res.status(200).send('OK');

        if (!req.body || !req.body.message) {
            console.log("Empty payload received.");
            return;
        }

        // Decode the base64 payload from Google Pub/Sub
        const decodedData = Buffer.from(req.body.message.data, 'base64').toString('utf-8');
        const { historyId, emailAddress } = JSON.parse(decodedData);
        
        console.log(`\n[RENDER] Webhook caught! Email: ${emailAddress} | historyId: ${historyId}`);

        // TODO: Use Gmail API here to fetch the actual email body using the historyId.
        // For testing the AI pipeline right now, we use a mock email string:
        const rawEmailText = "Subject: Interview Invitation\nHi Arjit, we would like to schedule your technical interview for next Tuesday at 2:00 PM EST.";

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // updated to fastest model
        
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
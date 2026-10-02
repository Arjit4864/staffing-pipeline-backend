import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis'; // 1. Added googleapis import
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

// Initialize Neon Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create the interviews table if it doesn't exist
pool.query(`
    CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255),
        interview_date VARCHAR(50),
        interview_time VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(err => console.error("Database initialization error:", err));

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

        const aiResponseText = result.response.text();
        console.log("\n--- Gemini AI Extraction Result ---");
        console.log(aiResponseText);

        // Strip Markdown code blocks if Gemini includes them (e.g., ```json ... ```)
        const cleanJsonString = aiResponseText.replace(/```json\n?|```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonString);

        // Save the structured data to Neon PostgreSQL
        const insertQuery = `
            INSERT INTO interviews (company, interview_date, interview_time)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const dbResult = await pool.query(insertQuery, [
            parsedData.company || 'Unknown', 
            parsedData.date || 'Unknown', 
            parsedData.time || 'Unknown'
        ]);

        console.log("\n[DATABASE] Successfully saved interview to Neon:", dbResult.rows[0]);

    } catch (error) {
        console.error("Webhook or Parsing Error:", error);
    }
});

const PORT = process.env.PORT || 5000;
// 6. SERVE DATA TO THE RECRUITER DASHBOARD
app.get('/api/candidates', async (req, res) => {
    try {
        // Fetch all scheduled interviews from Neon, newest first
        const result = await pool.query('SELECT * FROM interviews ORDER BY id DESC');
        
        // Send the data back as a JSON response
        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error("Database fetch error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch candidates" });
    }
});
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
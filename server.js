import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import cors from 'cors';
import pkg from 'pg';
import fs from 'fs';

const { Pool } = pkg;
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- OAUTH2 AUTHENTICATION ---
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const token = JSON.parse(fs.readFileSync('token.json'));
auth.setCredentials(token);

const gmail = google.gmail({ version: 'v1', auth });

// --- NEON POSTGRESQL DATABASE ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize table with the new role and type columns
pool.query(`
    CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255),
        interview_date VARCHAR(50),
        interview_time VARCHAR(50),
        role_title VARCHAR(255) DEFAULT 'Unknown',
        interview_type VARCHAR(100) DEFAULT 'Unknown',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(err => console.error("Database initialization error:", err));


// ==========================================
//                 API ROUTES
// ==========================================

// 1. CATCH WEBHOOK & PROCESS INCOMING EMAILS
app.post('/api/gmail-webhook', async (req, res) => {
    try {
        console.log("\n[RENDER] Webhook caught!");
        
        // Google Pub/Sub requires an immediate 200 OK response
        res.status(200).send("OK");

        const message = req.body.message;
        if (!message || !message.data) return;

        // Fetch the newest email triggered by the webhook
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 1
        });
        
        const messageId = listResponse.data.messages[0].id;
        const emailResponse = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        // Extract the full email body instead of just the short snippet
        const payload = emailResponse.data.payload;
        let emailText = emailResponse.data.snippet; // Fallback

        // Gmail encodes the body in base64, so we must decode it to plain text
        if (payload.parts) {
            const part = payload.parts.find(p => p.mimeType === 'text/plain');
            if (part && part.body && part.body.data) {
                emailText = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
        } else if (payload.body && payload.body.data) {
            emailText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }
        console.log("--- Fetched Real Email Content ---");
        console.log(emailText);

        // The Bouncer: Only pass emails containing job-related keywords to Gemini
        const keywords = ["interview", "application", "developer", "engineer", "position", "stripe"];
        const isJobRelated = keywords.some(word => emailText.toLowerCase().includes(word));

        if (!isJobRelated) {
            console.log("Ignored personal or irrelevant email.");
            return; // Stops the function here so Gemini is never called
        }

        // Expanded prompt to extract role and interview type. 
        // Fixed the variable reference to use ${emailText} instead of the undefined${emailBody}.
        const prompt = `Analyze this email body and extract the interview details. Return ONLY a valid JSON object with these exact keys:
{
  "company": "Company Name",
  "interview_date": "Date like Thursday, October 15th",
  "interview_time": "Time like 10:30 AM EST",
  "role_title": "The exact job role or position title (e.g., Software Engineer, Data Analyst). If not found, use 'Unknown'",
  "interview_type": "Categorize the interview round (e.g., HR Screen, Technical, Behavioral, System Design, Final Round). If not found, use 'Unknown'"
}
Email Body: ${emailText}`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const aiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        const aiData = await aiResponse.json();
        
        console.log("--- Raw Gemini API Response ---");
        console.log(JSON.stringify(aiData, null, 2));

        if (!aiData.candidates) {
            console.error("API Error: Missing candidates array. The request was rejected by Google.");
            return; 
        }

        const aiResponseText = aiData.candidates[0].content.parts[0].text;
        
        console.log("--- Gemini AI Extraction Result ---");
        console.log(aiResponseText);

        // Parse Gemini's JSON block and clean markdown
        const cleanJsonString = aiResponseText.replace(/```json\n?|```/g, '').trim();
        const rawData = JSON.parse(cleanJsonString);

        // Normalize keys to lowercase to prevent mismatch errors
        const parsedData = Object.fromEntries(
            Object.entries(rawData).map(([k, v]) => [k.toLowerCase(), v])
        );

        // Insert extracted data into Neon PostgreSQL including the two new fields.
        // Fixed previous mapping errors where parsedData.date was used instead of parsedData.interview_date.
        const insertQuery = `
            INSERT INTO interviews (company, interview_date, interview_time, role_title, interview_type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const dbResult = await pool.query(insertQuery, [
            parsedData.company || 'Unknown', 
            parsedData.interview_date || 'Unknown', 
            parsedData.interview_time || 'Unknown',
            parsedData.role_title || 'Unknown',
            parsedData.interview_type || 'Unknown'
        ]);

        console.log("[DATABASE] Successfully saved interview to Neon:", dbResult.rows[0]);

    } catch (error) {
        console.error("Webhook processing error:", error);
    }
});

// 2. SERVE DATA TO THE REACT FRONTEND DASHBOARD
app.get('/api/candidates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM interviews ORDER BY id DESC');
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

// 3. RENEW GMAIL WATCH SUBSCRIPTION
app.get('/api/start-watch', async (req, res) => {
    try {
        const response = await gmail.users.watch({
            userId: 'me', 
            requestBody: {
                labelFilterAction: 'include',
                labelIds: ['INBOX'],
                topicName: 'projects/ai-job-applier-488220/topics/gmail-events' 
            }
        });
        console.log("Watch activated:", response.data);
        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        console.error("Watch activation failed:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});

app.get('/', (req, res) => {
  res.status(200).send('Backend is alive');
});
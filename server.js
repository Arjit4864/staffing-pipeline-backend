import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
// Reads credentials from the files securely stored in your Render environment
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

// Initialize table if it doesn't exist yet
pool.query(`
    CREATE TABLE IF NOT EXISTS interviews (
        id SERIAL PRIMARY KEY,
        company VARCHAR(255),
        interview_date VARCHAR(50),
        interview_time VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(err => console.error("Database initialization error:", err));

// --- GEMINI AI CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


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

        const emailText = emailResponse.data.snippet; 
        console.log("--- Fetched Real Email Content ---");
        console.log(emailText);

        // Extract parameters using Gemini 1.5 Flash
        const prompt = `
            Extract the following details from this interview invitation email:
            Company Name, Date of Interview, Time of Interview.
            Return ONLY a raw JSON object with keys "company", "date", and "time".
            Email text: "${emailText}"
        `;
        
        const aiResult = await aiModel.generateContent(prompt);
        const aiResponseText = aiResult.response.text();
        
        console.log("--- Gemini AI Extraction Result ---");
        console.log(aiResponseText);

        // Parse Gemini's JSON block
        const cleanJsonString = aiResponseText.replace(/```json\n?|```/g, '').trim();
        const parsedData = JSON.parse(cleanJsonString);

        // Insert extracted data into Neon PostgreSQL
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
            userId: 'me', // 'me' automatically uses the authenticated token's email
            requestBody: {
                labelFilterAction: 'include',
                labelIds: ['INBOX'],
                // NOTE: Ensure this matches your exact Google Cloud Pub/Sub topic string
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
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// 1. Resume Ingestion & Parsing
app.post('/api/parse-resume', upload.single('resume'), async (req, res) => {
    try {
        const pdfData = await pdfParse(req.file.buffer);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        full_name: { type: SchemaType.STRING },
                        email: { type: SchemaType.STRING },
                        phone: { type: SchemaType.STRING },
                        skills: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                        years_experience: { type: SchemaType.NUMBER },
                        availability: { type: SchemaType.STRING },
                        ai_summary: { type: SchemaType.STRING }
                    },
                    required: ["full_name", "email", "skills", "years_experience"]
                }
            }
        });

        const prompt = `Extract the candidate profile from this resume: ${pdfData.text}`;
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text());

        const query = `
            INSERT INTO candidates (full_name, email, phone, skills, years_experience, availability, ai_summary) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
        `;
        const dbRes = await pool.query(query, [
            data.full_name, data.email, data.phone, 
            JSON.stringify(data.skills), data.years_experience, 
            data.availability, data.ai_summary
        ]);
        
        res.status(200).json(dbRes.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Parsing failed' });
    }
});

// 2. Gmail Pub/Sub Webhook Receiver
app.post('/api/gmail-webhook', async (req, res) => {
    try {
        const message = req.body.message;
        if (!message) return res.status(400).send('No message');
        
        // Decode Pub/Sub Base64 payload
        const data = Buffer.from(message.data, 'base64').toString('utf-8');
        const { historyId, emailAddress } = JSON.parse(data);
        
        console.log(`New email event for ${emailAddress} at historyId: ${historyId}`);
        
        // Next step: Use Gmail API to fetch the email via historyId,
        // pass the body to Gemini to detect interview dates, and UPDATE the database row.
        
        res.status(200).send('Webhook acknowledged');
    } catch (error) {
        console.error(error);
        res.status(500).send('Webhook error');
    }
});

app.get('/api/candidates', async (req, res) => {
    const result = await pool.query('SELECT * FROM candidates ORDER BY created_at DESC');
    res.json(result.rows);
});

app.listen(5000, () => console.log('Backend running on port 5000'));
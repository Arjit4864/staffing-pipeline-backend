import { google } from 'googleapis';
import fs from 'fs';
import readline from 'readline';

// Read your local credentials.json
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
});

console.log('Authorize this app by visiting this url:\n', authUrl);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('\nEnter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
        if (err) return console.error('Error retrieving access token', err);
        fs.writeFileSync('token.json', JSON.stringify(token));
        console.log('Token stored to token.json successfully!');
    });
});
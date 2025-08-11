// Import libraries
const express = require('express');
const { google } = require('googleapis');
const { Client } = require('@line/bot-sdk');
const cors = require('cors'); // Import the cors library
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// --- 1. SET UP LINE MESSAGING API CLIENT ---
// Get LINE API credentials from environment variables for security
const lineClient = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// --- 2. SET UP GOOGLE SHEETS API ---
// Load service account key from the environment variable or a file
let auth;
try {
    const keyFile = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: keyFile.client_email,
            private_key: keyFile.private_key.replace(/\\n/g, '\n'), // Handle escaped newlines
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} catch (e) {
    console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_KEY. Make sure it is a valid JSON string.');
    console.error(e);
    // Fallback to file-based key for local development
    auth = new google.auth.GoogleAuth({
        keyFile: './your-service-account-key.json', // Use file for local testing
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID; // Your Google Sheet ID

// --- 3. API ENDPOINT TO RECEIVE BOOKING DATA FROM LIFF APP ---
// This endpoint URL must match the one you set in the LIFF App settings.
app.post('/api/booking', async (req, res) => {
    try {
        const bookingData = req.body;
        console.log('Received booking data:', bookingData);

        // Prepare data for Google Sheets
        const rowData = [
            bookingData.timestamp,
            bookingData.date,
            bookingData.time,
            bookingData.mainService,
            bookingData.subService,
            bookingData.technician,
            bookingData.price,
            bookingData.customerName,
            bookingData.lineUserId,
            bookingData.phoneNumber,
            bookingData.notes,
        ];

        // Append data to Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Booking_Data!A:K', // Adjust the sheet name and range as needed
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        console.log('Booking data saved to Google Sheets.');

        // Send confirmation message to the customer via LINE Messaging API
        if (bookingData.lineUserId) {
            await lineClient.pushMessage(bookingData.lineUserId, {
                type: 'text',
                text: '✅ ยืนยันการจองของคุณสำเร็จแล้ว! ขอบคุณที่ใช้บริการครับ',
            });
            console.log('Confirmation message sent to customer.');
        }

        // Send notification message to the technician
        // You'll need to replace 'YOUR_TECHNICIAN_LINE_ID' with the actual LINE User ID of the technician
        const technicianMessage = `มีคิวจองใหม่!
        วันที่: ${bookingData.date}
        เวลา: ${bookingData.time}
        ลูกค้า: ${bookingData.customerName}
        บริการ: ${bookingData.mainService} > ${bookingData.subService}
        ช่าง: ${bookingData.technician}
        เบอร์โทร: ${bookingData.phoneNumber}`;

        await lineClient.pushMessage(process.env.TECHNICIAN_LINE_ID, {
            type: 'text',
            text: technicianMessage,
        });
        console.log('Notification message sent to technician.');

        res.status(200).json({ success: true, message: 'Booking confirmed successfully.' });

    } catch (error) {
        console.error('Error processing booking:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// Basic endpoint for checking server status (optional)
app.get('/', (req, res) => {
    res.send('Server is running and ready to accept bookings.');
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Import libraries
const express = require('express');
const { google } = require('googleapis');
const { Client, middleware } = require('@line/bot-sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- 1. SET UP LINE MESSAGING API CLIENT and Webhook Middleware ---
// Get LINE API credentials from environment variables for security
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

// The middleware is only applied to the /webhook endpoint
const lineMiddleware = middleware(lineConfig);

// --- 2. SET UP GOOGLE SHEETS API ---
// Load service account key from the environment variable or a file
const keyFile = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: keyFile.client_email,
        private_key: keyFile.private_key.replace(/\\n/g, '\n'), // Handle escaped newlines
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID; // Your Google Sheet ID

// --- 3. API ENDPOINT TO RECEIVE BOOKING DATA FROM LIFF APP ---
// This endpoint URL must match the one you set in the LIFF App settings.
// It DOES NOT use the LINE middleware
app.post('/api/booking', express.json(), async (req, res) => {
    try {
        const bookingData = req.body;
        console.log('Received booking data:', bookingData);

        // Prepare data for Google Sheets
        const rowData = [
            new Date().toISOString(), // Add timestamp here
            bookingData.date,
            bookingData.time,
            bookingData.mainService,
            bookingData.subService,
            bookingData.technician,
            bookingData.price,
            bookingData.customerName,
            bookingData.lineUserId,
            bookingData.phone,
            bookingData.notes,
        ];

        // Append data to Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A:K', // Adjust the sheet name and range as needed
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
        const technicianMessage = `มีคิวจองใหม่!
        วันที่: ${bookingData.date}
        เวลา: ${bookingData.time}
        ลูกค้า: ${bookingData.customerName}
        บริการ: ${bookingData.mainService} > ${bookingData.subService}
        ช่าง: ${bookingData.technician}
        เบอร์โทร: ${bookingData.phone}`;

        await lineClient.pushMessage(process.env.TECHNICIAN_LINE_ID, {
            type: 'text',
            text: technicianMessage,
        });
        console.log('Notification message sent to technician.');

        res.status(200).json({ success: true, message: 'Booking confirmed successfully.' });

    } catch (error) {
        console.error('Error processing booking:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
});

// --- 4. WEBHOOK ENDPOINT FOR LINE MESSAGING API ---
// This endpoint is for LINE to send events to. It uses the LINE middleware.
app.post('/webhook', lineMiddleware, async (req, res) => {
    console.log('Received webhook event:', JSON.stringify(req.body.events));
    // Reply to messages
    const event = req.body.events[0];
    if (event && event.type === 'message' && event.message.type === 'text') {
        const replyText = `คุณส่งข้อความมาว่า: "${event.message.text}"
        หากต้องการจองคิว โปรดใช้ LIFF App ผ่าน Rich Menu ครับ`;
        await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: replyText,
        });
    }

    res.status(200).send('OK');
});

// Basic endpoint for checking server status (optional)
app.get('/', (req, res) => {
    res.send('Server is running and ready to accept bookings.');
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// Import libraries
const express = require('express');
const { google } = require('googleapis');
const { Client } = require('@line/bot-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to read JSON from the request body and enable CORS
app.use(express.json());
app.use(cors());

// --- 1. SET UP THE LINE MESSAGING API CLIENT ---
// Fetch Channel Access Token and Channel Secret from Environment Variables
const lineClient = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// --- 2. SET UP THE GOOGLE SHEETS API ---
// Fetch Service Account Key from Environment Variables
let auth;
try {
    const keyFile = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: keyFile.client_email,
            private_key: keyFile.private_key.replace(/\\n/g, '\n'),
        },
        // Add scope for reading and writing data
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/spreadsheets'],
    });
} catch (e) {
    console.error('Error reading GOOGLE_SERVICE_ACCOUNT_KEY. Please ensure the value is a valid JSON string.');
    console.error(e);
    // Fallback for local development
    auth = new google.auth.GoogleAuth({
        keyFile: './your-service-account-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const bookingSheetName = 'Hair_Salon_Bookings';
const technicianSheetName = 'Technicians';
const serviceSheetName = 'Services'; // New sheet name for services

// --- Helper function to find technician's LINE User ID from the sheet ---
/**
 * Searches the Technicians sheet for a technician's name and returns their LINE User ID.
 * @param {string} technicianName The name of the technician to find.
 * @returns {Promise<string|null>} The LINE User ID or null if not found.
 */
async function getTechnicianUserId(technicianName) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${technicianSheetName}!A:B`, // Assuming 'ชื่อช่าง' is in column A and 'LINE User ID' in column B
        });
        const rows = response.data.values || [];
        const technicianRow = rows.slice(1).find(row => row[0] === technicianName);
        return technicianRow ? technicianRow[1] : null;
    } catch (error) {
        console.error('Error fetching technician user ID:', error);
        return null;
    }
}

// --- NEW API ENDPOINT for getting technician list ---
app.get('/api/technicians', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${technicianSheetName}!A:A`, // Read only the column with technician names
        });
        const rows = response.data.values || [];
        const technicians = rows.slice(1).map(row => row[0]); // Skip header and extract names
        res.status(200).json(technicians);
    } catch (error) {
        console.error('Error fetching technicians:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- NEW API ENDPOINT for getting services and prices ---
app.get('/api/services', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${serviceSheetName}!A:C`, // Read Main Service (A), Sub Service (B), and Price (C)
        });
        const rows = response.data.values || [];
        if (rows.length === 0) {
            return res.status(200).json({ mainServices: [], subServices: [], prices: {} });
        }

        const mainServicesSet = new Set();
        const subServicesSet = new Set();
        const prices = {};

        // Skip the header row and process data
        rows.slice(1).forEach(row => {
            const main = row[0];
            const sub = row[1];
            const price = parseInt(row[2], 10);

            if (main) {
                mainServicesSet.add(main);
            }
            if (sub) {
                subServicesSet.add(sub);
            }
            // Create a unique key for the service combination
            const serviceKey = `${main}-${sub}`;
            prices[serviceKey] = price;
        });

        const data = {
            mainServices: Array.from(mainServicesSet),
            subServices: Array.from(subServicesSet),
            prices: prices,
        };

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- API ENDPOINT for checking availability ---
app.get('/api/availability', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'โปรดระบุวันที่ที่ต้องการตรวจสอบ' });
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${bookingSheetName}!B:C`,
        });

        const bookedSlots = [];
        const existingBookings = response.data.values || [];

        if (existingBookings.length > 0) {
            existingBookings.slice(1).forEach(row => {
                const bookingDate = row[0];
                const bookingTime = row[1];
                if (bookingDate === date) {
                    bookedSlots.push(bookingTime);
                }
            });
        }

        console.log(`Checking slots on ${date}: Found ${bookedSlots.length} bookings.`);
        res.status(200).json(bookedSlots);

    } catch (error) {
        console.error('Error checking availability:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- API ENDPOINT to receive booking data from the LIFF App ---
app.post('/api/booking', async (req, res) => {
    try {
        const bookingData = req.body;
        console.log('Received booking data:', bookingData);

        // Check for duplicate bookings before saving
        const { date, time } = bookingData;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${bookingSheetName}!B:C`,
        });

        const existingBookings = response.data.values || [];
        const isAlreadyBooked = existingBookings.some(row => row[0] === date && row[1] === time);

        if (isAlreadyBooked) {
            console.warn(`Duplicate booking: Date ${date}, Time ${time} is already booked.`);
            return res.status(409).json({ success: false, message: 'ช่วงเวลาที่คุณเลือกมีผู้จองแล้ว' });
        }
        // End of duplicate booking check

        // Prepare data for Google Sheets
        const rowData = [
            bookingData.timestamp,
            bookingData.date,
            bookingData.time,
            bookingData.mainService,
            bookingData.subService,
            bookingData.technician,
            bookingData.price, // Ensure the price is included
            bookingData.customerName,
            bookingData.lineUserId,
            bookingData.phoneNumber,
            bookingData.notes,
        ];

        // Save data to Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${bookingSheetName}!A:K`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        console.log('Booking data successfully saved to Google Sheets.');

        // Send confirmation message to the customer
        if (bookingData.lineUserId) {
            await lineClient.pushMessage(bookingData.lineUserId, {
                type: 'text',
                text: `✅ ยืนยันการจองทำผมของคุณสำเร็จ!
วันที่: ${bookingData.date}
เวลา: ${bookingData.time}
บริการ: ${bookingData.mainService} ${bookingData.subService ? `+ ${bookingData.subService}` : ''}
ช่าง: ${bookingData.technician}
ราคา: ${bookingData.price} บาท
ขอบคุณที่ใช้บริการครับ`,
            });
            console.log('Confirmation message sent to the customer.');
        }

        // Find technician's User ID and send notification
        const technicianUserId = await getTechnicianUserId(bookingData.technician);
        if (technicianUserId) {
            const technicianMessage = `📢 มีคิวทำผมใหม่!
วันที่: ${bookingData.date}
เวลา: ${bookingData.time}
ลูกค้า: ${bookingData.customerName}
บริการ: ${bookingData.mainService} ${bookingData.subService ? `+ ${bookingData.subService}` : ''}
ราคา: ${bookingData.price} บาท
ช่าง: ${bookingData.technician}
เบอร์โทร: ${bookingData.phoneNumber}
หมายเหตุ: ${bookingData.notes}`;

            await lineClient.pushMessage(technicianUserId, {
                type: 'text',
                text: technicianMessage,
            });
            console.log(`Notification message sent to technician: ${bookingData.technician}`);
        } else {
            console.warn(`LINE User ID not found for technician: ${bookingData.technician}. Cannot send notification.`);
        }

        res.status(200).json({ success: true, message: 'Booking confirmed successfully.' });

    } catch (error) {
        console.error('Error processing booking:', error);
        let errorMessage = 'Internal Server Error';
        if (error.code === 400 && error.errors?.[0]?.message) {
            errorMessage = error.errors[0].message;
        }
        res.status(500).json({ success: false, message: errorMessage });
    }
});

// Endpoint for testing the server
app.get('/', (req, res) => {
    res.send('Server for Hair Salon Booking is running.');
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

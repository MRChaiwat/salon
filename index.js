// โค้ดสำหรับ LINE Bot Server ที่แก้ไขแล้ว
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { google } = require('googleapis');
const moment = require('moment');
require('dotenv').config();

const app = express();

// กำหนดค่า LINE Bot จาก Environment Variables
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(lineConfig);

// กำหนดค่า Google Sheets และ Google Service Account จาก Environment Variables
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
let serviceAccountKey;
try {
    serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_KEY:', e);
    // Exit the process if the key is invalid to prevent further errors
    process.exit(1); 
}

const jwtClient = new google.auth.JWT(
    serviceAccountKey.client_email,
    null,
    serviceAccountKey.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({
    version: 'v4',
    auth: jwtClient
});

// กำหนดพอร์ตสำหรับเซิร์ฟเวอร์
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Middleware สำหรับ LINE Bot
// โค้ดส่วนนี้จะทำงานกับ webhook จาก LINE โดยตรง
app.use(middleware(lineConfig));

// Endpoint สำหรับ Webhook ของ LINE
app.post('/webhook', (req, res) => {
    // ส่ง HTTP 200 OK กลับไปทันที เพื่อให้ LINE รู้ว่าเซิร์ฟเวอร์ได้รับคำขอแล้ว
    res.status(200).send('OK');
    Promise.all(req.body.events.map(handleEvent))
        .catch((err) => {
            console.error('Error processing LINE events:', err);
        });
});

// ** Endpoint ใหม่สำหรับรับข้อมูลการจองจาก LIFF App **
// เราจำเป็นต้องใช้ body-parser เพื่ออ่านข้อมูล JSON ที่ส่งมาจาก Frontend
app.use(express.json());
app.post('/booking', async (req, res) => {
    try {
        const { date, time, mainService, subService, technician, price, customerName, lineUserId, phone, notes } = req.body;

        // เตรียมข้อมูลที่จะบันทึกลง Google Sheets
        const rowData = [
            moment().format('YYYY-MM-DD HH:mm:ss'), // Timestamp
            date, // BookingDate
            time, // BookingTime
            mainService, // MainService
            subService, // SubService
            technician, // Technician
            price, // Price
            customerName, // CustomerName
            lineUserId, // LINEUserID
            phone, // PhoneNumber
            notes, // Notes
        ];

        // บันทึกข้อมูลลงใน Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:K', // กำหนดช่วงเซลล์ที่ต้องการบันทึก
            valueInputOption: 'RAW',
            requestBody: {
                values: [rowData],
            },
        });

        // ส่งข้อความแจ้งเตือนหาลูกค้า (ผ่าน LINE Messaging API)
        const customerMessage = {
            type: 'text',
            text: `ยืนยันการจองของคุณ:\nวันที่: ${date}\nเวลา: ${time}\nบริการ: ${subService}\nช่าง: ${technician}\nราคารวม: ฿${price}`
        };
        await client.pushMessage(lineUserId, customerMessage);

        // ส่งข้อความแจ้งเตือนหาช่าง (ถ้ามี LINE ID ของช่าง)
        const technicianMessage = {
            type: 'text',
            text: `มีการจองคิวใหม่!\nลูกค้า: ${customerName}\nวันที่: ${date}\nเวลา: ${time}\nบริการ: ${subService}\nช่าง: ${technician}\nเบอร์โทร: ${phone}`
        };
        // ใช้ process.env.TECHNICIAN_LINE_ID ที่คุณระบุไว้
        if (process.env.TECHNICIAN_LINE_ID) {
            await client.pushMessage(process.env.TECHNICIAN_LINE_ID, technicianMessage);
        }
        
        res.status(200).json({ success: true, message: 'Booking confirmed' });

    } catch (error) {
        console.error('Error adding booking from LIFF app:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm booking' });
    }
});

// ฟังก์ชันจัดการเหตุการณ์จาก LINE
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }
    const message = event.message.text;

    // ตรวจสอบข้อความคำสั่ง "จองคิว"
    if (message.includes('จองคิว')) {
        // ในโค้ดจริง ตรงนี้จะเปิด LIFF app ขึ้นมา
        const replyMessage = {
            type: 'text',
            text: 'กรุณาใช้ Mini App เพื่อจองคิว'
        };
        await client.replyMessage(event.replyToken, replyMessage);
    } else {
        // ตอบกลับข้อความที่ไม่ตรงกับคำสั่ง
        const replyMessage = { type: 'text', text: 'สวัสดีครับ โปรดพิมพ์ "จองคิว" เพื่อเริ่มต้นการจอง' };
        await client.replyMessage(event.replyToken, replyMessage);
    }
}

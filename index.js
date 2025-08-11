// โค้ดสำหรับ LINE Bot Server ที่แก้ไขแล้ว
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
require('dotenv').config();

const app = express();

// กำหนดค่า LINE Bot จาก Environment Variables
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(lineConfig);

// กำหนดค่า Google Calendar จาก Environment Variables
const calendarId = process.env.GOOGLE_CALENDAR_ID;
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
    ['https://www.googleapis.com/auth/calendar']
);

const calendar = google.calendar({
    version: 'v3',
    auth: jwtClient
});

// กำหนดพอร์ตสำหรับเซิร์ฟเวอร์
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});


// Middleware สำหรับ LINE Bot
// ใช้ middleware ของ LINE เพียงตัวเดียวเท่านั้น
app.use(middleware(lineConfig));

// Endpoint สำหรับ Webhook ของ LINE
app.post('/webhook', (req, res) => {
    // ส่ง HTTP 200 OK กลับไปทันที เพื่อให้ LINE รู้ว่าเซิร์ฟเวอร์ได้รับคำขอแล้ว
    res.status(200).send('OK');

    // ประมวลผลเหตุการณ์จาก LINE ในเบื้องหลัง
    Promise.all(req.body.events.map(handleEvent))
        .catch((err) => {
            console.error('Error processing LINE events:', err);
        });
});

// ฟังก์ชันจัดการเหตุการณ์จาก LINE
async function handleEvent(event) {
    // กรองเหตุการณ์ที่ไม่ใช่ข้อความ
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const message = event.message.text;

    console.log(`Received message from user ${userId}: ${message}`);

    // ตรวจสอบข้อความคำสั่ง "จองคิว"
    if (message.includes('จองคิว')) {
        // ... (โค้ดสำหรับสร้างการจองคิว)
        try {
            // สร้าง Event ใน Google Calendar
            const eventId = uuidv4();
            const summary = `จองคิวจาก LINE: ${userId}`;
            const description = `ข้อความจากลูกค้า: ${message}`;
            const startDateTime = moment().add(1, 'hour').toISOString();
            const endDateTime = moment().add(2, 'hour').toISOString();

            const response = await calendar.events.insert({
                calendarId: calendarId,
                resource: {
                    id: eventId,
                    summary: summary,
                    description: description,
                    start: {
                        dateTime: startDateTime,
                        timeZone: 'Asia/Bangkok',
                    },
                    end: {
                        dateTime: endDateTime,
                        timeZone: 'Asia/Bangkok',
                    },
                },
            });

            // ส่งข้อความตอบกลับไปยัง LINE
            const replyMessage = { 
                type: 'text', 
                text: `จองคิวให้แล้ว! ID: ${eventId}\nเวลา: ${moment(startDateTime).format('lll')} - ${moment(endDateTime).format('lll')}` 
            };
            await client.replyMessage(event.replyToken, replyMessage);

        } catch (error) {
            console.error('Error adding event to Google Calendar:', error);
            const replyMessage = { type: 'text', text: 'ขออภัย เกิดข้อผิดพลาดในการจองคิว' };
            await client.replyMessage(event.replyToken, replyMessage);
        }
    } else {
        // ตอบกลับข้อความที่ไม่ตรงกับคำสั่ง
        const replyMessage = { type: 'text', text: 'สวัสดีครับ โปรดพิมพ์ "จองคิว" เพื่อเริ่มต้นการจอง' };
        await client.replyMessage(event.replyToken, replyMessage);
    }
}

// Import libraries
const express = require('express');
const { google } = require('googleapis');
const { Client } = require('@line/bot-sdk');
const cors = require('cors'); 
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware เพื่ออ่านข้อมูล JSON จาก Request Body และเปิดใช้งาน CORS
app.use(express.json());
app.use(cors());

// --- 1. ตั้งค่า LINE MESSAGING API CLIENT ---
// ดึงค่า Channel Access Token และ Channel Secret จาก Environment Variables
const lineClient = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// --- 2. ตั้งค่า GOOGLE SHEETS API ---
// ดึงค่า Service Account Key จาก Environment Variables หรือไฟล์ (สำหรับ Local)
let auth;
try {
    const keyFile = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: keyFile.client_email,
            private_key: keyFile.private_key.replace(/\\n/g, '\n'),
        },
        // เพิ่ม scope สำหรับการอ่านและเขียนข้อมูล
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/spreadsheets'], 
    });
} catch (e) {
    console.error('เกิดข้อผิดพลาดในการอ่าน GOOGLE_SERVICE_ACCOUNT_KEY. โปรดตรวจสอบว่าค่าที่ตั้งเป็น JSON string ที่ถูกต้อง');
    console.error(e);
    auth = new google.auth.GoogleAuth({
        keyFile: './your-service-account-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const sheetName = 'Booking_Data'; // กำหนดชื่อชีตให้ชัดเจน

// --- 3. API ENDPOINT สำหรับตรวจสอบความพร้อมใช้งาน (ใหม่) ---
// รับพารามิเตอร์ 'date' จาก Frontend เพื่อตรวจสอบว่ามีคิวจองแล้วหรือไม่
app.get('/api/availability', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'โปรดระบุวันที่ที่ต้องการตรวจสอบ' });
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!B:C`, // อ่านเฉพาะคอลัมน์วันที่ (B) และเวลา (C)
        });
        
        const bookedSlots = [];
        const existingBookings = response.data.values || [];
        
        // กรองข้อมูลเพื่อหาเวลาที่ถูกจองในวันที่ต้องการ
        if (existingBookings.length > 0) {
            // ข้ามแถว header
            existingBookings.slice(1).forEach(row => {
                const bookingDate = row[0];
                const bookingTime = row[1];
                if (bookingDate === date) {
                    bookedSlots.push(bookingTime);
                }
            });
        }
        
        console.log(`ตรวจสอบคิวในวันที่ ${date}: พบการจอง ${bookedSlots.length} คิว`);
        res.status(200).json(bookedSlots);

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการตรวจสอบคิวว่าง:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- 4. API ENDPOINT สำหรับรับข้อมูลการจองจาก LIFF App ---
app.post('/api/booking', async (req, res) => {
    try {
        const bookingData = req.body;
        console.log('ข้อมูลการจองที่ได้รับ:', bookingData);

        // **ขั้นตอนใหม่: ตรวจสอบการจองซ้ำก่อนบันทึก**
        const { date, time } = bookingData;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!B:C`, // อ่านคอลัมน์ Date (B) และ Time (C)
        });

        const existingBookings = response.data.values || [];
        const isAlreadyBooked = existingBookings.some(row => row[0] === date && row[1] === time);

        if (isAlreadyBooked) {
            console.warn(`การจองซ้ำ: วันที่ ${date} เวลา ${time} มีผู้จองแล้ว`);
            return res.status(409).json({ success: false, message: 'ช่วงเวลาที่คุณเลือกมีผู้จองแล้ว' });
        }
        // **สิ้นสุดขั้นตอนการตรวจสอบการจองซ้ำ**

        // เตรียมข้อมูลสำหรับ Google Sheets
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

        // บันทึกข้อมูลลง Google Sheets
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:K`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });

        console.log('บันทึกข้อมูลการจองลง Google Sheets สำเร็จแล้ว');

        // ส่งข้อความยืนยันไปยังลูกค้า
        if (bookingData.lineUserId) {
            await lineClient.pushMessage(bookingData.lineUserId, {
                type: 'text',
                text: `✅ ยืนยันการจองของคุณสำเร็จแล้ว! วันที่ ${bookingData.date} เวลา ${bookingData.time} ขอบคุณที่ใช้บริการครับ`,
            });
            console.log('ส่งข้อความยืนยันการจองถึงลูกค้าแล้ว');
        }

        // ส่งข้อความแจ้งเตือนไปยังช่าง
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
        console.log('ส่งข้อความแจ้งเตือนถึงช่างแล้ว');

        res.status(200).json({ success: true, message: 'Booking confirmed successfully.' });

    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการประมวลผลการจอง:', error);
        let errorMessage = 'Internal Server Error';
        if (error.code === 400 && error.errors?.[0]?.message) {
            errorMessage = error.errors[0].message;
        }
        res.status(500).json({ success: false, message: errorMessage });
    }
});

// Endpoint สำหรับการทดสอบ Server
app.get('/', (req, res) => {
    res.send('Server is running and ready to accept bookings.');
});

// เริ่มต้น Server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

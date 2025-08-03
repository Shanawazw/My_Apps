const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const Razorpay = require('razorpay');
const cors = require('cors');

const app = express();

// Basic middleware setup
app.use(cors());
app.use(express.json({limit: '50mb'}));

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, user-id');
    res.header('ngrok-skip-browser-warning', 'true');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: 'rzp_test_tyHySwr8kW0u99',
    key_secret: 'cCyPBCY52C3uLcDTtyBmOV25'
});

// ROOT ROUTE - MUST BE FIRST
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>DataCleaner Pro API</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; }
                h1 { color: #007bff; }
                .status { background: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; }
                ul { background: #f8f9fa; padding: 20px; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🧹 DataCleaner Pro Backend</h1>
                <div class="status">
                    <strong>✅ API is running successfully!</strong>
                </div>
                <p>This backend powers your DataCleaner Pro application.</p>
                <h3>Available endpoints:</h3>
                <ul>
                    <li><strong>POST /upload</strong> - Upload and analyze CSV/Excel files</li>
                    <li><strong>POST /create-order</strong> - Create payment order</li>
                    <li><strong>POST /verify-payment</strong> - Verify payment</li>
                </ul>
                <p><em>Use your frontend app to interact with these endpoints.</em></p>
                <p><strong>Server Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
        </body>
        </html>
    `);
});

// Create directories if they don't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Simple user session storage
let userSessions = {};

// Language Detection Functions
function detectLanguage(text) {
    if (!text || typeof text !== 'string') return 'unknown';
    
    const tamilPattern = /[\u0B80-\u0BFF]/;
    const englishPattern = /[a-zA-Z]/;
    const numberPattern = /[0-9]/;
    
    const hasTamil = tamilPattern.test(text);
    const hasEnglish = englishPattern.test(text);
    const hasNumbers = numberPattern.test(text);
    
    if (hasTamil && hasEnglish) return 'mixed';
    if (hasTamil) return 'tamil';
    if (hasEnglish) return 'english';
    if (hasNumbers && !hasEnglish && !hasTamil) return 'numbers';
    
    return 'unknown';
}

// Dummy Data Detection Functions
function isDummyData(text) {
    if (!text || typeof text !== 'string') return false;
    
    const value = text.trim();
    const patterns = [
        /^1+$/, /^0+$/, /^9+$/,
        /^(.)(\1{4,})$/,
        /^(1234|2345|3456|4567|5678|6789|7890)+$/,
        /^(abcd|efgh|test|dummy|sample|placeholder)$/i,
        /^(டெஸ்ட்|சாம்பிள்|டம்மி)$/,
    ];
    
    return patterns.some(pattern => pattern.test(value));
}

// Phone number detection
function isPhoneNumber(text) {
    if (!text || typeof text !== 'string') return false;
    const cleaned = text.replace(/\D/g, '');
    return cleaned.length >= 7 && cleaned.length <= 15;
}

// Email detection
function isEmail(text) {
    if (!text || typeof text !== 'string') return false;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(text.trim());
}

// Analyze data for issues
function analyzeData(data) {
    const issues = [];
    const languageStats = { tamil: 0, english: 0, mixed: 0, numbers: 0 };
    
    data.forEach((row, rowIndex) => {
        Object.keys(row).forEach(column => {
            const value = row[column];
            if (!value) return;
            
            const valueStr = String(value);
            const lang = detectLanguage(valueStr);
            
            if (languageStats[lang] !== undefined) {
                languageStats[lang]++;
            }
            
            if (isDummyData(valueStr)) {
                issues.push({
                    type: 'dummy_data',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Possible dummy data detected`
                });
            }
            
            if (lang === 'mixed') {
                issues.push({
                    type: 'mixed_language',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Mixed Tamil and English text`
                });
            }
            
            const columnLower = column.toLowerCase();
            
            if (isPhoneNumber(valueStr) && !columnLower.includes('phone') && !columnLower.includes('mobile') && !columnLower.includes('contact')) {
                issues.push({
                    type: 'column_mismatch',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Phone number found in ${column} column`,
                    suggestion: 'Move to Phone/Mobile column'
                });
            }
            
            if (isEmail(valueStr) && !columnLower.includes('email') && !columnLower.includes('mail')) {
                issues.push({
                    type: 'column_mismatch',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Email found in ${column} column`,
                    suggestion: 'Move to Email column'
                });
            }
        });
    });
    
    return {
        issues: issues,
        languageStats: languageStats,
        totalIssues: issues.length
    };
}

// Check user limits
function checkUserLimits(userId) {
    if (!userId) {
        const newUserId = 'free_user_' + Date.now();
        userSessions[newUserId] = {
            plan: 'free',
            filesProcessed: 0,
            createdAt: new Date()
        };
        return { allowed: true, filesLeft: 5, plan: 'free', newUserId: newUserId };
    }
    
    if (!userSessions[userId]) {
        userSessions[userId] = {
            plan: 'free',
            filesProcessed: 0,
            createdAt: new Date()
        };
    }
    
    const user = userSessions[userId];
    
    if (user.plan === 'pro') {
        return { allowed: true, filesLeft: 'unlimited', plan: 'pro' };
    }
    
    const filesLeft = Math.max(0, 5 - user.filesProcessed);
    
    return { 
        allowed: filesLeft > 0, 
        filesLeft: filesLeft, 
        plan: 'free' 
    };
}

// API Routes
app.post('/create-order', async (req, res) => {
    try {
        const options = {
            amount: 99900,
            currency: 'INR',
            receipt: 'receipt_' + Date.now(),
            notes: {
                plan: 'DataCleaner Pro Monthly'
            }
        };

        const order = await razorpay.orders.create(options);
        res.json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ success: false, error: 'Failed to create payment order' });
    }
});

app.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, user_email } = req.body;
        
        const userId = 'user_' + Date.now();
        userSessions[userId] = {
            email: user_email,
            plan: 'pro',
            filesProcessed: 0,
            subscriptionDate: new Date(),
            paymentId: razorpay_payment_id
        };
        
        res.json({
            success: true,
            userId: userId,
            message: 'Payment successful! Welcome to DataCleaner Pro!'
        });
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ success: false, error: 'Payment verification failed' });
    }
});

app.post('/upload', upload.single('csvFile'), (req, res) => {
    console.log('Upload route hit!');
    
    const userId = req.headers['user-id'] || null;
    const userLimits = checkUserLimits(userId);
    
    let responseUserId = userId;
    if (userLimits.newUserId) {
        responseUserId = userLimits.newUserId;
    }
    
    if (!userLimits.allowed) {
        return res.json({ 
            success: false,
            error: 'Free plan limit reached. Upgrade to Pro for unlimited files!',
            needsUpgrade: true 
        });
    }

    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const results = [];
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    try {
        if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            const analysis = analyzeData(jsonData);
            
            if (responseUserId && userSessions[responseUserId]) {
                userSessions[responseUserId].filesProcessed++;
            }
            
            fs.unlinkSync(filePath);
            
            res.json({
                success: true,
                data: jsonData,
                rowCount: jsonData.length,
                columns: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
                fileType: 'Excel',
                analysis: analysis,
                userInfo: userLimits,
                userId: responseUserId
            });
            
        } else if (fileExtension === '.csv') {
            fs.createReadStream(filePath)
                .pipe(csv({
                    skipEmptyLines: true,
                    headers: true
                }))
                .on('data', (data) => {
                    results.push(data);
                })
                .on('end', () => {
                    const analysis = analyzeData(results);
                    
                    if (responseUserId && userSessions[responseUserId]) {
                        userSessions[responseUserId].filesProcessed++;
                    }
                    
                    fs.unlinkSync(filePath);
                    
                    res.json({
                        success: true,
                        data: results,
                        rowCount: results.length,
                        columns: results.length > 0 ? Object.keys(results[0]) : [],
                        fileType: 'CSV',
                        analysis: analysis,
                        userInfo: userLimits,
                        userId: responseUserId
                    });
                })
                .on('error', (error) => {
                    console.error('Error parsing CSV:', error);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    res.status(500).json({ success: false, error: 'Error parsing CSV file: ' + error.message });
                });
        } else {
            fs.unlinkSync(filePath);
            res.status(400).json({ success: false, error: 'Please upload a CSV or Excel file (.csv, .xlsx, .xls)' });
        }
    } catch (error) {
        console.error('Error processing file:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ success: false, error: 'Error processing file: ' + error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ DataCleaner Pro API running on port ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`📁 Upload CSV and Excel files to start cleaning data!`);
});

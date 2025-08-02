const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const Razorpay = require('razorpay');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Initialize Razorpay with your actual keys
const razorpay = new Razorpay({
    key_id: 'rzp_test_tyHySwr8kW0u99',
    key_secret: 'cCyPBCY52C3uLcDTtyBmOV25'
});

// Serve static files and parse JSON
app.use(express.static('public'));
app.use(express.json({limit: '50mb'}));

// Set proper headers for Tamil text
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// Create directories if they don't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

// Simple user session storage (replace with database later)
let userSessions = {};

// Language Detection Functions
function detectLanguage(text) {
    if (!text || typeof text !== 'string') return 'unknown';
    
    // Tamil Unicode range: U+0B80 to U+0BFF
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
    
    // Pattern checks
    const patterns = [
        /^1+$/, // All 1s (1111111)
        /^0+$/, // All 0s (0000000)
        /^9+$/, // All 9s (9999999)
        /^(.)(\1{4,})$/, // Same character repeated 5+ times
        /^(1234|2345|3456|4567|5678|6789|7890)+$/, // Sequential numbers
        /^(abcd|efgh|test|dummy|sample|placeholder)$/i, // Common dummy words
        /^(டெஸ்ட்|சாம்பிள்|டம்மி)$/, // Tamil dummy words
    ];
    
    return patterns.some(pattern => pattern.test(value));
}

// Phone number detection
function isPhoneNumber(text) {
    if (!text || typeof text !== 'string') return false;
    const cleaned = text.replace(/\D/g, ''); // Remove non-digits
    return cleaned.length >= 7 && cleaned.length <= 15; // More flexible range
}

function hasPhoneIssues(text) {
    if (!text || typeof text !== 'string') return null;
    
    const issues = [];
    const cleaned = text.replace(/\D/g, '');
    
    // Check for invalid patterns
    if (text.startsWith('-') || text.includes('--')) {
        issues.push('Invalid format - starts with minus or has double minus');
    }
    
    // Check for clearly fake numbers
    if (/^-?\d+$/.test(text) && (parseInt(text) < 0 || text === '0000000000' || text === '1111111111')) {
        issues.push('Appears to be fake/dummy number');
    }
    
    // Check for inconsistent formatting
    if (text.includes('.') && text.includes('-')) {
        issues.push('Mixed punctuation in phone number');
    }
    
    // Check for extensions in wrong place
    if (text.includes('x') && !text.includes('ext')) {
        issues.push('Extension format should be "ext" not "x"');
    }
    
    return issues.length > 0 ? issues : null;
}

// Email detection
function isEmail(text) {
    if (!text || typeof text !== 'string') return false;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(text.trim());
}

function hasEmailIssues(text) {
    if (!text || typeof text !== 'string') return null;
    
    const issues = [];
    
    // Check for extra characters at end
    if (text.endsWith('o') && text.includes('@') && !text.endsWith('.co')) {
        issues.push('Extra character "o" at end of email');
    }
    
    // Check for missing TLD
    if (text.includes('@') && !text.includes('.')) {
        issues.push('Email missing domain extension (.com, .org, etc.)');
    }
    
    // Check for spaces in email
    if (text.includes('@') && text.includes(' ')) {
        issues.push('Email contains spaces');
    }
    
    return issues.length > 0 ? issues : null;
}

// Date format detection
function hasDateIssues(text) {
    if (!text || typeof text !== 'string') return null;
    
    const issues = [];
    
    // Check if it looks like a date
    if (/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(text)) {
        const parts = text.split(/[-\/]/);
        
        // Check for inconsistent date formats
        if (parts.length === 3) {
            const [part1, part2, part3] = parts;
            
            if (part3.length === 2) {
                issues.push('Year should be 4 digits (2020 not 20)');
            }
            
            if (parseInt(part2) > 12) {
                issues.push('Month value appears invalid (greater than 12)');
            }
            
            if (parseInt(part1) > 31) {
                issues.push('Day value appears invalid (greater than 31)');
            }
        }
    }
    
    return issues.length > 0 ? issues : null;
}

// ID/Code format detection
function hasIdIssues(text) {
    if (!text || typeof text !== 'string') return null;
    
    const issues = [];
    
    // Check for inconsistent ID formats
    if (text.length > 8 && /^[A-Z0-9]+$/.test(text)) {
        // Looks like an ID, check for patterns
        if (text.length !== 12 && text.length !== 10) {
            issues.push('ID length inconsistent with standard formats');
        }
    }
    
    return issues.length > 0 ? issues : null;
}

// Analyze data for issues - Enhanced
function analyzeData(data) {
    const issues = [];
    const languageStats = { tamil: 0, english: 0, mixed: 0, numbers: 0 };
    
    data.forEach((row, rowIndex) => {
        Object.keys(row).forEach(column => {
            const value = row[column];
            if (!value) return; // Skip empty values
            
            const valueStr = String(value);
            const lang = detectLanguage(valueStr);
            
            // Track language distribution
            if (languageStats[lang] !== undefined) {
                languageStats[lang]++;
            }
            
            // Check for dummy data
            if (isDummyData(valueStr)) {
                issues.push({
                    type: 'dummy_data',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Possible dummy data detected`
                });
            }
            
            // Check for language mixing
            if (lang === 'mixed') {
                issues.push({
                    type: 'mixed_language',
                    row: rowIndex + 1,
                    column: column,
                    value: valueStr,
                    message: `Mixed Tamil and English text`
                });
            }
            
            // Enhanced column-specific checks
            const columnLower = column.toLowerCase();
            
            // Phone number specific issues
            if (columnLower.includes('phone') || columnLower.includes('mobile') || columnLower.includes('contact')) {
                const phoneIssues = hasPhoneIssues(valueStr);
                if (phoneIssues) {
                    phoneIssues.forEach(issue => {
                        issues.push({
                            type: 'format_issue',
                            row: rowIndex + 1,
                            column: column,
                            value: valueStr,
                            message: `Phone number issue: ${issue}`
                        });
                    });
                }
            }
            
            // Email specific issues
            if (columnLower.includes('email') || columnLower.includes('mail')) {
                const emailIssues = hasEmailIssues(valueStr);
                if (emailIssues) {
                    emailIssues.forEach(issue => {
                        issues.push({
                            type: 'format_issue',
                            row: rowIndex + 1,
                            column: column,
                            value: valueStr,
                            message: `Email issue: ${issue}`
                        });
                    });
                }
            }
            
            // Date specific issues
            if (columnLower.includes('date') || columnLower.includes('subscription')) {
                const dateIssues = hasDateIssues(valueStr);
                if (dateIssues) {
                    dateIssues.forEach(issue => {
                        issues.push({
                            type: 'format_issue',
                            row: rowIndex + 1,
                            column: column,
                            value: valueStr,
                            message: `Date format issue: ${issue}`
                        });
                    });
                }
            }
            
            // ID/Customer ID issues
            if (columnLower.includes('id') || columnLower.includes('customer')) {
                const idIssues = hasIdIssues(valueStr);
                if (idIssues) {
                    idIssues.forEach(issue => {
                        issues.push({
                            type: 'format_issue',
                            row: rowIndex + 1,
                            column: column,
                            value: valueStr,
                            message: `ID format issue: ${issue}`
                        });
                    });
                }
            }
            
            // General column misalignment detection
            // Phone numbers in wrong columns
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
            
            // Emails in wrong columns
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
    console.log('Checking limits for user:', userId); // Debug
    
    if (!userId) {
        // Create new free user session
        const newUserId = 'free_user_' + Date.now();
        userSessions[newUserId] = {
            plan: 'free',
            filesProcessed: 0,
            createdAt: new Date()
        };
        return { allowed: true, filesLeft: 5, plan: 'free', newUserId: newUserId };
    }
    
    // Check if user exists in sessions
    if (!userSessions[userId]) {
        // Create free user session if doesn't exist
        userSessions[userId] = {
            plan: 'free',
            filesProcessed: 0,
            createdAt: new Date()
        };
    }
    
    const user = userSessions[userId];
    console.log('User session:', user); // Debug
    
    if (user.plan === 'pro') {
        return { allowed: true, filesLeft: 'unlimited', plan: 'pro' };
    }
    
    // Free user limits
    const filesLeft = Math.max(0, 5 - user.filesProcessed);
    console.log('Files processed:', user.filesProcessed, 'Files left:', filesLeft); // Debug
    
    return { 
        allowed: filesLeft > 0, 
        filesLeft: filesLeft, 
        plan: 'free' 
    };
}

// Create payment order
app.post('/create-order', async (req, res) => {
    try {
        const options = {
            amount: 99900, // ₹999 in paise
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
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

// Verify payment
app.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, user_email } = req.body;
        
        // In production, verify the signature properly
        // For now, we'll assume payment is successful
        
        // Create user session
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
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

// Route to handle CSV and Excel upload with user limits
app.post('/upload', upload.single('csvFile'), (req, res) => {
    console.log('Upload route hit!'); // Debug log
    console.log('File received:', req.file ? 'YES' : 'NO'); // Debug log
    
    const userId = req.headers['user-id'] || null;
    const userLimits = checkUserLimits(userId);
    
    // If new user ID was created, send it back
    let responseUserId = userId;
    if (userLimits.newUserId) {
        responseUserId = userLimits.newUserId;
    }
    
    console.log('User limits result:', userLimits); // Debug log
    
    if (!userLimits.allowed) {
        return res.status(403).json({ 
            error: 'Free plan limit reached. Upgrade to Pro for unlimited files!',
            needsUpgrade: true 
        });
    }

    if (!req.file) {
        console.log('No file in request'); // Debug log
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const results = [];
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    console.log('Processing file:', req.file.originalname, 'Extension:', fileExtension); // Debug log

    try {
        if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            console.log('Processing Excel file...'); // Debug log
            // Handle Excel files
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            console.log('Excel data parsed, rows:', jsonData.length); // Debug log
            
            // Analyze the data for issues
            const analysis = analyzeData(jsonData);
            
            // Update user file count
            if (responseUserId && userSessions[responseUserId]) {
                userSessions[responseUserId].filesProcessed++;
                console.log('Updated file count for user:', responseUserId, 'New count:', userSessions[responseUserId].filesProcessed);
            }
            
            // Clean up uploaded file
            fs.unlinkSync(filePath);
            
            console.log('Sending response for Excel file'); // Debug log
            
            // Send parsed data back with analysis and user info
            res.json({
                success: true,
                data: jsonData,
                rowCount: jsonData.length,
                columns: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
                fileType: 'Excel',
                analysis: analysis,
                userInfo: userLimits,
                userId: responseUserId // Send user ID back to frontend
            });
            
        } else if (fileExtension === '.csv') {
            console.log('Processing CSV file...'); // Debug log
            // Handle CSV files with better error handling
            fs.createReadStream(filePath)
                .pipe(csv({
                    skipEmptyLines: true,
                    headers: true
                }))
                .on('data', (data) => {
                    results.push(data);
                })
                .on('end', () => {
                    console.log('CSV data parsed, rows:', results.length); // Debug log
                    
                    // Analyze the data for issues
                    const analysis = analyzeData(results);
                    
                    // Update user file count
                    if (userId && userSessions[userId]) {
                        userSessions[userId].filesProcessed++;
                    }
                    
                    // Clean up uploaded file
                    fs.unlinkSync(filePath);
                    
                    console.log('Sending response for CSV file'); // Debug log
                    
                    // Send parsed data back with analysis and user info
                    res.json({
                        success: true,
                        data: results,
                        rowCount: results.length,
                        columns: results.length > 0 ? Object.keys(results[0]) : [],
                        fileType: 'CSV',
                        analysis: analysis,
                        userInfo: userLimits
                    });
                })
                .on('error', (error) => {
                    console.error('Error parsing CSV:', error);
                    // Clean up file on error
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    res.status(500).json({ error: 'Error parsing CSV file: ' + error.message });
                });
        } else {
            // Unsupported file type
            fs.unlinkSync(filePath);
            res.status(400).json({ error: 'Please upload a CSV or Excel file (.csv, .xlsx, .xls)' });
        }
    } catch (error) {
        console.error('Error processing file:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.status(500).json({ error: 'Error processing file: ' + error.message });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Data Cleaner app running on port ${PORT}`);
    console.log('Upload your CSV and Excel files and start cleaning your data!');
});



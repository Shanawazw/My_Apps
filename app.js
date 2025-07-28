const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files
app.use(express.static('public'));

// Set proper headers for Tamil text
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Create public directory if it doesn't exist
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

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

// Phone number detection - Enhanced
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

// Email detection - Enhanced
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
    
    // Common date patterns
    const datePatterns = [
        /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
        /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY
        /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    ];
    
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

// Email detection
function isEmail(text) {
    if (!text || typeof text !== 'string') return false;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(text.trim());
}

// Analyze data for issues - Enhanced
function analyzeData(data) {
    const issues = [];
    const languageStats = { tamil: 0, english: 0, mixed: 0, numbers: 0 };
    const columnIssues = {};
    
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

// Route to handle CSV and Excel upload
app.post('/upload', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const results = [];
    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    try {
        if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            // Handle Excel files
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0]; // Get first sheet
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            // Analyze the data for issues
            const analysis = analyzeData(jsonData);
            
            // Clean up uploaded file
            fs.unlinkSync(filePath);
            
            // Send parsed data back with analysis
            res.json({
                success: true,
                data: jsonData,
                rowCount: jsonData.length,
                columns: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
                fileType: 'Excel',
                analysis: analysis
            });
            
        } else if (fileExtension === '.csv') {
            // Handle CSV files
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => {
                    results.push(data);
                })
                .on('end', () => {
                    // Analyze the data for issues
                    const analysis = analyzeData(results);
                    
                    // Clean up uploaded file
                    fs.unlinkSync(filePath);
                    
                    // Send parsed data back with analysis
                    res.json({
                        success: true,
                        data: results,
                        rowCount: results.length,
                        columns: results.length > 0 ? Object.keys(results[0]) : [],
                        fileType: 'CSV',
                        analysis: analysis
                    });
                })
                .on('error', (error) => {
                    console.error('Error parsing CSV:', error);
                    res.status(500).json({ error: 'Error parsing CSV file' });
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
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Data Cleaner app running on http://localhost:${PORT}`);
    console.log('Upload your CSV files and start cleaning your data!');
});
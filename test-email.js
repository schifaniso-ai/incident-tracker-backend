const transporter = require('./services/emailService');

async function sendTestEmail() {
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'Incident Tracker - Email Test',
            text: 'Congratulations! Your Incident Tracker email notification system is working successfully.'
        });

        console.log('Email sent successfully!');
        console.log('Message ID:', info.messageId);

    } catch (error) {
        console.log('Email sending failed:', error.message);
    }
}

sendTestEmail();
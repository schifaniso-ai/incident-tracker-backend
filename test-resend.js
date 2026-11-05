
require('dotenv').config();

const { sendEmail } = require('./config/email');

const testResend = async () => {
  try {
    const result = await sendEmail({
      to: process.env.RESEND_TEST_EMAIL,
      subject: 'Incident Tracker - Email Test',
      html: `
        <h2>Hello!</h2>
        <p>Your Incident Tracker email notification system
        is now connected to Resend.</p>
        <p>We are successfully testing email delivery.</p>
        <strong>Incident Tracker Team</strong>
      `,
    });

    if (result.error) {
      console.error('Email failed:', result.error);
      return;
    }

    console.log('Email sent successfully!');
    console.log('Email ID:', result.data.id);

  } catch (error) {
    console.error('Email error:', error.message);
  }
};

testResend();

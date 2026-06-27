const nodemailer = require('nodemailer');

const SMTP_CONFIG = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
};

// Single-send transporter (OTP, account creation)
const transporter = nodemailer.createTransport(SMTP_CONFIG);

// Pooled transporter for bulk sends — reuses up to 5 concurrent connections
const bulkTransporter = nodemailer.createTransport({
  ...SMTP_CONFIG,
  pool:           true,
  maxConnections: 5,
  maxMessages:    Infinity,
  rateDelta:      1000,
  rateLimit:      10,
});

// Verify SMTP connection on startup
transporter.verify((err) => {
  if (err) {
    console.error('❌ SMTP connection failed:', err.message);
  } else {
    console.log('✅ SMTP connection ready — emails can be sent.');
  }
});

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const sendOTPEmail = async (to, subject, otp, purpose = 'verification') => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Tarlac State University</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">${subject}</h2>
        <p style="color:#4a5568;margin:0 0 24px;font-size:15px;line-height:1.6;">
          Use the 6-digit code below to complete your <strong>${purpose}</strong>.
          This code expires in <strong>10 minutes</strong>.
        </p>
        <div style="background:#f7fafc;border:2px dashed #C49A2A;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:38px;font-weight:700;letter-spacing:14px;color:#7B1A2E;font-family:monospace;">${otp}</span>
        </div>
        <p style="color:#718096;font-size:13px;margin:0;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

const sendAccountCreatedEmail = async (to, firstName, tempPassword) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Tarlac State University</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Welcome, ${firstName}!</h2>
        <p style="color:#4a5568;margin:0 0 24px;font-size:15px;line-height:1.6;">
          Your TSU Alumni Portal account has been created by an administrator.
          Use the credentials below to log in for the first time.
        </p>
        <div style="background:#f7fafc;border:2px dashed #C49A2A;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:13px;color:#718096;">Email</p>
          <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#2d3748;">${to}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#718096;">Temporary Password</p>
          <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:4px;color:#7B1A2E;font-family:monospace;">${tempPassword}</p>
        </div>
        <p style="color:#e53e3e;font-size:13px;margin:0 0 8px;font-weight:600;">
          Please change your password after logging in.
        </p>
        <p style="color:#718096;font-size:13px;margin:0;">
          If you did not expect this email, please contact the administrator.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Your TSU Alumni Portal Account',
    html,
  });
};

const sendEmploymentReminderBulk = async (emails) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Tarlac State University</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Dear Alumni,</h2>
        <p style="color:#4a5568;margin:0 0 16px;font-size:15px;line-height:1.6;">
          This is a reminder from the <strong>TSU Alumni Office</strong> to please update your
          employment details on the Alumni Portal. Your information is needed for our
          <strong>accreditation records</strong>.
        </p>
        <p style="color:#4a5568;margin:0 0 24px;font-size:15px;line-height:1.6;">
          Please log in to the portal and fill in or update your employment information
          at your earliest convenience.
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}"
             style="display:inline-block;background:#7B1A2E;color:#fff;text-decoration:none;
                    padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            Update My Employment Details
          </a>
        </div>
        <p style="color:#718096;font-size:13px;margin:0;">
          If you have already updated your details recently, you may disregard this email.
          Thank you for your continued cooperation.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to:      process.env.EMAIL_USER,
    bcc:     emails.join(','),
    subject: 'Reminder: Please Update Your Employment Details',
    html,
  });
};

module.exports = { generateOTP, sendOTPEmail, sendAccountCreatedEmail, sendEmploymentReminderBulk };

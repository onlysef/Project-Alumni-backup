const nodemailer = require('nodemailer');

// Applied to every user-supplied value interpolated into an HTML email body
// (employer message text, company/applicant names, free-text location) —
// without this, an employer could type raw HTML/links into "Send a mail" or
// an interview invite and have it render for real in the alumnus's inbox.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Welcome, ${escapeHtml(firstName)}!</h2>
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

  // Sending every recipient in one BCC on the single-send `transporter` was
  // two separate problems: Gmail SMTP enforces per-message recipient caps
  // and aggressive rate limiting, so a large cohort either gets throttled/
  // rejected as a single unit (no partial delivery) or trips spam
  // detection — and `bulkTransporter` was already built with pooled
  // connections and its own rate limit specifically to spread this load,
  // but nothing ever actually sent through it. Batching into
  // Gmail-friendly chunks and sending each through the pooled transporter
  // fixes both; allSettled means one bad batch doesn't take down the rest.
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) batches.push(emails.slice(i, i + BATCH_SIZE));

  const results = await Promise.allSettled(batches.map((batch) =>
    bulkTransporter.sendMail({
      from:    `"TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
      to:      process.env.EMAIL_USER,
      bcc:     batch.join(','),
      subject: 'Reminder: Please Update Your Employment Details',
      html,
    })
  ));

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length) {
    throw failed[0].reason instanceof Error ? failed[0].reason : new Error('All reminder email batches failed to send.');
  }
  if (failed.length) {
    failed.forEach((f) => console.error('sendEmploymentReminderBulk batch failed:', f.reason?.message || f.reason));
  }
};

const sendInquiryEmail = async (fromName, fromEmail, subject, message) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">New Inquiry from the Alumni Office page</p>
      </div>
      <div style="padding:32px 40px;">
        <p style="color:#718096;margin:0 0 8px;font-size:13px;">From</p>
        <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#2d3748;">${escapeHtml(fromName)} &lt;${escapeHtml(fromEmail)}&gt;</p>
        <p style="color:#718096;margin:0 0 8px;font-size:13px;">Subject</p>
        <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#2d3748;">${escapeHtml(subject)}</p>
        <p style="color:#718096;margin:0 0 8px;font-size:13px;">Message</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#4a5568;white-space:pre-wrap;">${escapeHtml(message)}</p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to:      process.env.EMAIL_USER,
    replyTo: fromEmail,
    subject: `[Alumni Inquiry] ${subject}`,
    html,
  });
};

// Employer -> applicant, from the "Send a mail" action on an applicant's
// profile. replyTo is the employer's own account email so the alumnus can
// just hit reply — this app never sees or stores that reply.
const sendApplicantMessageEmail = async (to, applicantName, companyName, fromEmail, subject, message) => {
  const safeCompany = escapeHtml(companyName);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Message from ${safeCompany}</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Hi ${escapeHtml(applicantName)},</h2>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a5568;white-space:pre-wrap;">${escapeHtml(message)}</p>
        <p style="color:#718096;font-size:13px;margin:0;">
          Sent by <strong>${safeCompany}</strong> through the TSU Alumni Portal. Reply directly to this
          email to respond to ${escapeHtml(fromEmail)}.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"${companyName} via TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: fromEmail,
    subject,
    html,
  });
};

// Alumnus -> alumnus, from the "Send an email" button on another alumnus's
// profile in Suggested Alumni. Sent for real through the backend instead of
// a mailto: link, same reasoning as sendApplicantMessageEmail: a mailto:
// link does nothing useful if the browser has no default mail client
// configured. replyTo is the sender's own account email so the recipient
// can just hit reply — this app never sees or stores that reply.
const sendAlumniMessageEmail = async (to, recipientName, fromName, fromEmail, subject, message) => {
  const safeFromName = escapeHtml(fromName);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Message from ${safeFromName}</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Hi ${escapeHtml(recipientName)},</h2>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a5568;white-space:pre-wrap;">${escapeHtml(message)}</p>
        <p style="color:#718096;font-size:13px;margin:0;">
          Sent by <strong>${safeFromName}</strong>, a fellow TSU alumnus, through the TSU Alumni Portal.
          Reply directly to this email to respond to ${escapeHtml(fromEmail)}.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"${fromName} via TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: fromEmail,
    subject,
    html,
  });
};

// Employer -> applicant, sent the moment an interview is scheduled from the
// employer's Appointments page. replyTo is the employer's own account email
// so the alumnus can reply straight to it, same pattern as sendApplicantMessageEmail.
const sendInterviewInvitationEmail = async (to, applicantName, companyName, position, whenLabel, mode, location, fromEmail) => {
  const safeCompany = escapeHtml(companyName);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Interview invitation from ${safeCompany}</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">Hi ${escapeHtml(applicantName)},</h2>
        <p style="color:#4a5568;margin:0 0 20px;font-size:15px;line-height:1.6;">
          <strong>${safeCompany}</strong> would like to invite you to an interview for the
          <strong>${escapeHtml(position)}</strong> position.
        </p>
        <div style="background:#f7fafc;border:2px dashed #C49A2A;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:13px;color:#718096;">When</p>
          <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#2d3748;">${whenLabel}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#718096;">Mode</p>
          <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#2d3748;">${mode}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#718096;">${mode === 'Online' ? 'Meeting link' : 'Location'}</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#2d3748;">${escapeHtml(location) || 'To be confirmed'}</p>
        </div>
        <p style="color:#718096;font-size:13px;margin:0;">
          Sent by <strong>${safeCompany}</strong> through the TSU Alumni Portal. Reply directly to this
          email to respond to ${escapeHtml(fromEmail)}.
        </p>
      </div>
      <div style="background:#f7fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#a0aec0;font-size:12px;margin:0;">© 2026 TSU Alumni Portal · Tarlac State University</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"${companyName} via TSU Alumni Portal" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: fromEmail,
    subject: `Interview Invitation: ${position} at ${companyName}`,
    html,
  });
};

// Admin -> prospective employer, the special sign-up link (see
// EmployerInvite model / employerInviteController.js). This is the only way
// an employer account gets created — there's no public "Sign Up" page for them.
const sendEmployerInviteEmail = async (to, link) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#7B1A2E 0%,#9B2235 100%);padding:32px;text-align:center;">
        <h1 style="color:#C49A2A;font-family:Georgia,serif;margin:0;font-size:26px;">TSU Alumni Portal</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">Employer Partnership Invitation</p>
      </div>
      <div style="padding:32px 40px;">
        <h2 style="color:#2d3748;margin:0 0 10px;font-size:20px;">You're invited to join as a partner employer</h2>
        <p style="color:#4a5568;margin:0 0 24px;font-size:15px;line-height:1.6;">
          The TSU Alumni Office has invited you to create an employer account on the
          Alumni Portal, where you can post job opportunities to our graduates.
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${link}"
             style="display:inline-block;background:#7B1A2E;color:#fff;text-decoration:none;
                    padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            Create Your Employer Account
          </a>
        </div>
        <p style="color:#718096;font-size:13px;margin:0;">
          This link is unique to you and can only be used once. If you did not expect
          this invitation, you can safely ignore this email.
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
    subject: 'You are invited to join TSU Alumni Portal as an Employer Partner',
    html,
  });
};

module.exports = { generateOTP, sendOTPEmail, sendAccountCreatedEmail, sendEmploymentReminderBulk, sendInquiryEmail, sendApplicantMessageEmail, sendAlumniMessageEmail, sendInterviewInvitationEmail, sendEmployerInviteEmail };

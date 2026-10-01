// Run inside the existing Kuma container. Credentials never leave its notification database.
const sqlite3 = require('@louislam/sqlite3');
const nodemailer = require('nodemailer');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const message = JSON.parse(input);
  const db = new sqlite3.Database('/app/data/kuma.db', sqlite3.OPEN_READONLY);
  db.all('SELECT config FROM notification WHERE active=1', async (error, rows) => {
    db.close();
    try {
      if (error) throw error;
      const c = rows.map(row => JSON.parse(row.config)).find(c => c.type === 'smtp');
      if (!c) throw Error('No active SMTP notification');
      const transport = nodemailer.createTransport({host: c.smtpHost, port: Number(c.smtpPort),
        secure: !!c.smtpSecure, auth: c.smtpUsername ? {user: c.smtpUsername, pass: c.smtpPassword} : undefined,
        tls: {rejectUnauthorized: !c.smtpIgnoreTLSError}, connectionTimeout: 10000, socketTimeout: 15000});
      const result = await transport.sendMail({from: c.smtpFrom, to: message.to, subject: message.subject, text: message.text});
      transport.close();
      const ok = result.accepted.length > 0 && result.rejected.length === 0;
      console.log(JSON.stringify({ok}));
      process.exitCode = ok ? 0 : 1;
    } catch (_) { console.log(JSON.stringify({ok: false, error: 'smtp-send-failed'})); process.exitCode = 1; }
  });
});

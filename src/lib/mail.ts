import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_SMTP_PORT) || 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.MAIL_SMTP_NAME,
    pass: process.env.MAIL_SMTP_PASSWORD,
  },
})

function getFromAddress() {
  const name = process.env.MAIL_FROM_ADDRESS || 'IVE'
  const domain = process.env.MAIL_DOMAIN
  const smtpName = process.env.MAIL_SMTP_NAME
  // MAIL_FROM_ADDRESS에 @가 없으면 MAIL_DOMAIN 붙이기
  if (name.includes('@')) return name
  if (domain) return `${name}@${domain}`
  return smtpName || name
}

export async function sendVerificationEmail(to: string, code: string) {
  const from = getFromAddress()
  await transporter.sendMail({
    from: `"Spring IVE" <${from}>`,
    to,
    subject: '[Spring IVE] 이메일 인증 코드',
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4ade80; margin-bottom: 8px;">Spring IVE</h2>
        <p style="color: #666; margin-bottom: 20px;">이메일 인증 코드입니다.</p>
        <div style="background: #f4f4f4; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 20px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #222;">${code}</span>
        </div>
        <p style="color: #999; font-size: 12px;">이 코드는 10분간 유효합니다.</p>
      </div>
    `,
  })
}

import nodemailer from 'nodemailer'
import { getSystemSettings } from '@/lib/db'

function getSmtpConfig() {
  const s = getSystemSettings('mail.')
  return {
    host: s['mail.smtp_host'] || process.env.MAIL_SMTP_HOST || 'smtp.gmail.com',
    port: Number(s['mail.smtp_port'] || process.env.MAIL_SMTP_PORT) || 587,
    user: s['mail.smtp_user'] || process.env.MAIL_SMTP_NAME || '',
    pass: s['mail.smtp_password'] || process.env.MAIL_SMTP_PASSWORD || '',
    fromName: s['mail.from_name'] || process.env.MAIL_FROM_ADDRESS || 'IVE',
    domain: s['mail.domain'] || process.env.MAIL_DOMAIN || '',
  }
}

export function createTransporter() {
  const cfg = getSmtpConfig()
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: false, // STARTTLS
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })
}

export function getFromAddress() {
  const cfg = getSmtpConfig()
  if (cfg.fromName.includes('@')) return cfg.fromName
  if (cfg.domain) return `${cfg.fromName}@${cfg.domain}`
  return cfg.user || cfg.fromName
}

export async function sendVerificationEmail(to: string, code: string) {
  const transporter = createTransporter()
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

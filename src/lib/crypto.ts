import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || 'springware-ive-dev-encryption-key-change-in-prod',
  'salt',
  32
)

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // iv:tag:encrypted (모두 hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(data: string): string {
  try {
    if (!data || !data.includes(':')) return data // 암호화되지 않은 기존 데이터 처리
    const [ivHex, tagHex, encryptedHex] = data.split(':')
    if (!ivHex || !tagHex || !encryptedHex) return data
    
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch (err) {
    console.error('[Crypto] Decrypt failed, returning raw data:', err)
    return data
  }
}

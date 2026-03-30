import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, Locale } from './config'
import { getSystemSetting, setSystemSetting } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

function parseAcceptLanguage(header: string): Locale | null {
  const langs = header.split(',').map(part => {
    const [lang, q] = part.trim().split(';q=')
    return { lang: lang.split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1 }
  }).sort((a, b) => b.q - a.q)

  for (const { lang } of langs) {
    if (locales.includes(lang as Locale)) return lang as Locale
  }
  return null
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value

  let locale: Locale = defaultLocale

  // User's DB locale has highest priority if securely logged in
  let userDbLocale: Locale | null = null
  try {
    const user = await getCurrentUser()
    if (user && user.locale && locales.includes(user.locale as Locale)) {
      userDbLocale = user.locale as Locale
    }
  } catch { /* ignore auth errors during static rendering */ }

  if (userDbLocale) {
    locale = userDbLocale
  } else if (locales.includes(localeCookie as Locale)) {
    locale = localeCookie as Locale
  } else {
    const headerStore = await headers()
    const acceptLang = headerStore.get('accept-language')
    if (acceptLang) {
      locale = parseAcceptLanguage(acceptLang) ?? defaultLocale
    }
  }

  // Sync detected locale to system_settings for AI prompt language
  // Only write if the DB has no locale set yet (first-time users)
  try {
    const dbLocale = getSystemSetting('locale')
    if (!dbLocale) {
      setSystemSetting('locale', locale)
    }
  } catch { /* DB not ready yet during build */ }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})

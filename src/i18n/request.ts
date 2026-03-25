import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, Locale } from './config'

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

  if (locales.includes(localeCookie as Locale)) {
    locale = localeCookie as Locale
  } else {
    const headerStore = await headers()
    const acceptLang = headerStore.get('accept-language')
    if (acceptLang) {
      locale = parseAcceptLanguage(acceptLang) ?? defaultLocale
    }
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})

'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import { useTranslations } from 'next-intl'

export default function ChangePasswordPage() {
  const router = useRouter()
  const tAuth = useTranslations('auth')

  return (
    <div className="h-full flex justify-center overflow-hidden">
      <div className="w-full max-w-lg overflow-y-auto px-4">
        <div className="min-h-full flex items-center justify-center py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-1"><span className="text-[#22c55e]">Spring</span><span className="text-ive-amber">ware</span> <span className="text-ive-cyan">IVE</span></h1>
          <p className="text-base text-ive-text-muted">{tAuth('changePassword')}</p>
        </div>

        <ChangePasswordForm
          onSuccess={() => router.push('/login')}
        />

        <p className="text-center text-base text-ive-text-muted mt-6">
          <Link href="/login" className="text-ive-green font-bold">{tAuth('login')}</Link>
        </p>
      </div>
    </div>
    </div>
    </div>
  )
}

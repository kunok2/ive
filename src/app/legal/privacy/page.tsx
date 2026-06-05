import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalConfig } from '@/lib/legal-config'

export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  return <LegalDocument docKey="privacy" config={getLegalConfig()} />
}

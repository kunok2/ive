import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalConfig } from '@/lib/legal-config'

export const dynamic = 'force-dynamic'

export default function TermsPage() {
  return <LegalDocument docKey="terms" config={getLegalConfig()} />
}

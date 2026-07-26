import DevdashClient from './DevdashClient'

// Devdash must be dynamic — never pre-render with stale CDN-cached API data
export const dynamic = 'force-dynamic'

export default function DevdashPage() {
  return <DevdashClient />
}
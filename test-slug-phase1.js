// Test slug generation logic against the four required cases
// Simulates slugifyName + slugifyCity + uniqueInCity without DB

function slugifyName(name) {
  const cleaned = (name ?? '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'venue'
}

function slugifyCity(city) {
  return slugifyName(city ?? '')
}

function uniqueInCity(venueSlug, existingInCity) {
  if (!existingInCity.has(venueSlug)) return venueSlug
  for (let i = 2; i <= 99; i++) {
    const candidate = `${venueSlug}-${i}`
    if (!existingInCity.has(candidate)) return candidate
  }
  return `${venueSlug}-${Date.now()}`
}

function resolveNewSlug({ name, city, state }) {
  const venueSlug = slugifyName(name ?? '')
  const stateCode = (state ?? '').toLowerCase().trim()
  const cityRaw = city ?? ''
  const citySlug = slugifyCity(cityRaw)
  const hasState = stateCode.length === 2
  const hasCity = cityRaw.trim().length > 0
  const needsGeoReview = !hasState || !hasCity
  const stateSegment = hasState ? stateCode : 'unknown'
  const citySegment = hasCity ? citySlug : 'unknown-city'
  const fullPath = `/${stateSegment}/${citySegment}/${venueSlug}`
  return { path: needsGeoReview ? null : fullPath, needsGeoReview, fullPath }
}

// Case 1: "Clyde's" in LA
const c1 = resolveNewSlug({ name: "Clyde's", city: 'Los Angeles', state: 'CA' })
console.log('Case 1 — "Clyde\'s" in LA (CA):')
console.log('  Expected: /ca/los-angeles/clydes')
console.log('  Got:     ', c1.fullPath)
console.log('  needsGeoReview:', c1.needsGeoReview, '(should be false)')
console.log()

// Case 2: Same-city duplicate
const c2a = uniqueInCity('clydes', new Set())
console.log('Case 2 — same-city duplicate:')
console.log('  First "Clyde\'s":  ', uniqueInCity('clydes', new Set()))
console.log('  Second (taken):   ', uniqueInCity('clydes', new Set(['clydes'])))
console.log('  Third (taken):    ', uniqueInCity('clydes', new Set(['clydes', 'clydes-2'])))
console.log()

// Case 3: "Coeur d'Alene"
const c3 = slugifyCity("Coeur d'Alene")
console.log('Case 3 — "Coeur d\'Alene" city:')
console.log('  Expected: coeur-dalene')
console.log('  Got:     ', c3)
console.log()

// Case 4: Missing city
const c4 = resolveNewSlug({ name: "Clyde's", city: null, state: 'CA' })
console.log('Case 4 — missing city:')
console.log('  Got:     ', c4.fullPath)
console.log('  needsGeoReview:', c4.needsGeoReview, '(should be true)')
console.log()

// Case 5: Missing state
const c5 = resolveNewSlug({ name: "Clyde's", city: 'Los Angeles', state: null })
console.log('Case 5 — missing state:')
console.log('  Got:     ', c5.fullPath)
console.log('  needsGeoReview:', c5.needsGeoReview, '(should be true)')
console.log()

// Case 6: Both missing
const c6 = resolveNewSlug({ name: "Clyde's", city: null, state: null })
console.log('Case 6 — missing both:')
console.log('  Got:     ', c6.fullPath)
console.log('  needsGeoReview:', c6.needsGeoReview, '(should be true)')

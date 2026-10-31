// Fictional shops and illustrative products. Never live inventory or partner claims.
export const shops = [
  { id: 'wardrobe', name: 'The Everyday Studio', category: 'Fashion & accessories', note: 'Considered pieces. On repeat.', image: 'street-life.jpg', number: '01' },
  { id: 'objects', name: 'Objects & Other Things', category: 'Home & living', note: 'A little character for your space.', image: 'marylebone.jpg', number: '02' },
  { id: 'details', name: 'Small Details', category: 'Jewellery & gifts', note: 'Good things in small packages.', image: 'notting-hill.jpg', number: '03' },
];
export const products = [
  { id: 'knit', name: 'The everyday knit', category: 'Clothing', price: 6800, shop: 'wardrobe', image: 'knit.jpg', colour: 'Oat', sizes: ['XS', 'S', 'M', 'L'], description: 'An easy layer for slower mornings and everything that follows. A relaxed knit with a soft, textured finish.' },
  { id: 'trainers', name: 'Off-duty trainers', category: 'Footwear', price: 9500, shop: 'wardrobe', image: 'trainers.jpg', colour: 'Tan', sizes: ['UK 4', 'UK 5', 'UK 6', 'UK 7', 'UK 8'], description: 'For the long way home. An everyday trainer with a clean silhouette and a warm neutral finish.' },
  { id: 'chair', name: 'The reading chair', category: 'Home', price: 18500, shop: 'objects', image: 'chair.jpg', colour: 'Natural', sizes: ['One size'], description: 'Your new favourite corner. A sculptural accent chair with a quiet presence and plenty of character.' },
  { id: 'jewellery', name: 'A little gold', category: 'Jewellery', price: 4200, shop: 'details', image: 'jewellery.jpg', colour: 'Gold tone', sizes: ['One size'], description: 'An understated finishing touch. A simple piece to wear every day or give to someone you love.' },
  { id: 'bag', name: 'The weekend backpack', category: 'Accessories', price: 7900, shop: 'wardrobe', image: 'bag.jpg', colour: 'Black', sizes: ['One size'], description: 'Room for the essentials and a few things you find along the way. Made for getting out and about.' },
  { id: 'coat', name: 'Out-of-office layer', category: 'Clothing', price: 12500, shop: 'wardrobe', image: 'coat.jpg', colour: 'Neutral', sizes: ['XS', 'S', 'M', 'L'], description: 'A relaxed outer layer that takes you from a quick coffee to an unplanned afternoon out.' },
];
export const areas = [
  { name: 'Marylebone', postcode: 'W1U', image: 'marylebone.jpg', line: 'Bookshops, boutiques and a village pace.', headline: ['Marylebone,', 'at your own pace.'], intro: 'Bookshops on the high street, boutiques along the lanes. Marylebone rewards a slower wander and a turn off the main road.' },
  { name: 'Notting Hill', postcode: 'W11', image: 'notting-hill.jpg', line: 'Portobello, vintage and the unexpected.', headline: ['Notting Hill.', 'A taste for vintage.'], intro: 'Follow Portobello past the antiques and vintage rails, then wander towards Golborne Road. There’s more to Notting Hill than its painted houses.' },
  { name: 'Soho', postcode: 'W1F', image: 'soho.jpg', line: 'Find your style off Carnaby Street.', headline: ['Soho never', 'dresses quietly.'], intro: 'Carnaby draws the crowds; Newburgh Street and the lanes around it are worth the detour. Explore the boutiques and tailoring that give Soho its own style.' },
];
export const money = cents => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export function filterProducts({ query = '', category = 'All', shop = '', saved = null, sort = 'edit' } = {}) {
  const q = query.toLowerCase().trim();
  const result = products.filter(p => (!q || `${p.name} ${p.category} ${shops.find(s => s.id === p.shop).name}`.toLowerCase().includes(q)) && (category === 'All' || p.category === category) && (!shop || p.shop === shop) && (!saved || saved.has(p.id)));
  if (sort === 'low') result.sort((a, b) => a.price - b.price);
  if (sort === 'high') result.sort((a, b) => b.price - a.price);
  return result;
}
export function addToBag(bag, productId, size, replace = false) {
  const p = products.find(p => p.id === productId);
  if (!p || !p.sizes.includes(size)) throw new Error('Choose an available size.');
  if (bag.length && bag[0].shop !== p.shop && !replace) return { conflict: true, bag };
  const next = (replace ? [] : bag).map(item => ({ ...item }));
  const item = next.find(item => item.id === productId && item.size === size);
  if (item) item.quantity += 1;
  else next.push({ id: p.id, shop: p.shop, size, quantity: 1 });
  return { conflict: false, bag: next };
}
export const bagTotal = bag => bag.reduce((sum, item) => sum + products.find(p => p.id === item.id).price * item.quantity, 0);
export const bagCount = bag => bag.reduce((sum, item) => sum + item.quantity, 0);

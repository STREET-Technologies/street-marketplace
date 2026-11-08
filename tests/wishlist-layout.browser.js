// Run with Playwright CLI against localhost:4319; wishlist reads are mocked.
async page => {
  await page.unrouteAll();
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  const id='576fa9b6-3775-426c-86d5-5ef8710c35e9';
  let reads=0;
  await page.route('**/api/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session') return route.fulfill({json:{user:{id}}});
    if(path==='/api/customer-context') return route.fulfill({json:{userId:id,addresses:[],favourites:[]}});
    if(path==='/api/favourites') {
      reads++;
      return route.fulfill({json:{products:{items:Array.from({length:12},(_,i)=>({key:`product-${i}`,name:`Saved product ${i+1}`,vendorId:id,productId:id,image:null,status:'ready',shopName:'Local store'})),page:1,total:12,totalPages:1},shops:{items:[],page:1,total:0,totalPages:1}}});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:4319/saved');
  await page.getByText('12 saved',{exact:true}).waitFor();
  const tabs=page.getByRole('tablist',{name:'Wishlist collections'});
  if(await tabs.getAttribute('aria-orientation')!=='vertical') throw Error('Missing desktop sidebar');
  const positions=await page.locator('.saved-heading').evaluate(el=>{const title=el.querySelector('h2').getBoundingClientRect();const refresh=el.querySelector('button').getBoundingClientRect();const count=el.querySelector('p').getBoundingClientRect();return {gap:refresh.left-title.right,countOffset:count.left-title.left};});
  if(positions.gap>20||Math.abs(positions.countOffset)>1) throw Error('Heading controls not grouped');
  await page.screenshot({path:'/private/tmp/wishlist-sidebar-desktop.png'});
  const before=reads;
  await page.getByRole('button',{name:'Refresh products'}).click();
  await page.getByText('12 saved',{exact:true}).waitFor();
  if(reads<=before) throw Error('Refresh did not fetch');
  await page.evaluate(()=>window.scrollTo(0,600));
  await page.getByRole('tab',{name:'Stores',exact:true}).click();
  await page.getByRole('heading',{name:'No stores saved'}).waitFor();
  const geometry=await page.locator('.saved-heading').evaluate(el=>({top:el.getBoundingClientRect().top,header:document.querySelector('.marketplace-header').getBoundingClientRect().bottom}));
  if(geometry.top<geometry.header-1) throw Error('Heading hidden beneath sticky header');
  await page.getByRole('tab',{name:'Stores',exact:true}).press('ArrowUp');
  await page.getByText('12 saved',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/private/tmp/wishlist-sidebar-mobile.png'});
  if(await tabs.getAttribute('aria-orientation')!=='horizontal') throw Error('Mobile tabs not horizontal');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Mobile overflow');
  return 'PASS: sidebar, grouped count/refresh, refresh action, empty stores, scroll, keyboard and mobile tabs';
}

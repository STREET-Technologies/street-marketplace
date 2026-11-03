async (page) => {
  await page.unrouteAll();
  await page.setViewportSize({width:1440,height:1000});
  const vendorId='c7965184-84c3-40ef-9d97-c50468c37882', productId='ffaf20c2-6779-49c8-b1aa-e378c00030b1', locationGid='gid://shopify/Location/90313228547';
  const images=Array.from({length:7},(_,i)=>`https://cdn.shopify.com/s/files/gallery-test-${i}.png`);
  const large = new Set();
  await page.route('https://cdn.shopify.com/s/files/gallery-test-*', async route => {
    const url=new URL(route.request().url());
    if(Number(url.searchParams.get('width'))>=800) large.add(Number(url.pathname.match(/test-(\d+)/)[1]));
    await new Promise(r=>setTimeout(r,250));
    await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  });
  await page.route('**/api/**', async route => {
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/session') return route.fulfill({json:{user:null}});
    if(u.pathname==='/api/catalogue/browse') return route.fulfill({json:{id:productId,title:'Gallery loading test',images,description:'Fixture',options:[],variants:[]}});
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:4319/?'+new URLSearchParams({view:'product',vendorId,productId,locationGid,shop:'Fixture'}));
  await page.locator('.gallery-stage img').waitFor();
  await page.locator('.gallery-stage img').evaluate(img=>img.decode());
  await page.waitForTimeout(350);
  const beforeClick=[...large].sort();
  if(!large.has(1)||!large.has(2)||!large.has(6)) throw Error('Adjacent main images were not loaded before navigation: '+beforeClick);
  if(large.has(3)||large.has(4)||large.has(5)) throw Error('Gallery eagerly downloaded every full-size image');
  await page.getByRole('button',{name:'Next product image',exact:true}).click();
  await page.locator('.gallery-stage img').evaluate(img=>img.decode());
  await page.waitForTimeout(350);
  if(!large.has(3)) throw Error('Look-ahead did not follow selection');
  await page.getByRole('button',{name:'Show image 5',exact:true}).hover();
  await page.waitForTimeout(350);
  if(!large.has(4)) throw Error('Thumbnail intent did not preload the main image');
  return {beforeClick,afterNavigation:[...large].sort(),passed:true};
}

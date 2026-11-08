// Run with the Playwright CLI against localhost:4319. All APIs are mocked.
async page => {
  await page.setViewportSize({width:1440,height:1000});
  const owner='576fa9b6-3775-426c-86d5-5ef8710c35e9';
  const vendorId='e13ad453-943c-4861-891a-feae35a805d4';
  const outletId='0eb52280-293f-480e-ad39-ffa76970c1e1';
  const locationGid='gid://shopify/Location/81968234566';
  const product={id:owner,title:'Fixture shirt',description:'Fixture description',images:[],
    options:[{name:'Size',values:['S','M']},{name:'Colour',values:['Black','White']}],
    variants:[{id:'123',title:'S / Black',inventory:5,price:25},{id:'124',title:'M / Black',inventory:5,price:25},{id:'125',title:'S / White',inventory:2,price:25},{id:'126',title:'M / White',inventory:0,price:25}]};
  await page.unrouteAll();
  let release;
  let fail = false;
  await page.route('**/api/**', async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth/session') return route.fulfill({json:{user:{id:owner}}});
    if(url.pathname==='/api/customer-context') return route.fulfill({json:{userId:owner,addresses:[],favourites:[]}});
    if(url.pathname==='/api/catalogue/browse' && url.searchParams.get('kind')==='product') {
      await new Promise(resolve => { release = resolve; });
      if(fail) return route.fulfill({status:503,json:{error:'Product unavailable. Try again.'}});
    }
    if(url.pathname==='/api/catalogue/browse') return route.fulfill({json:url.searchParams.get('kind')==='product'?product:{facets:[],products:[{...product,price:25,image:null,vendorId,outletId,locationGid,productType:'Shirts',shopName:'Fixture',outletName:'London'}],page:1,total:1,totalPages:1}});
    return route.fulfill({status:503,json:{error:'Fixture: unavailable'}});
  });
  const url='http://localhost:4319/?'+new URLSearchParams({view:'catalogue',vendorId,outletId,locationGid,shop:'Fixture'});
  await page.goto(url);
  await page.evaluate(owner=>localStorage.removeItem(`street:staging:cart:v1:${owner}`),owner);
  await page.reload();
  const card = page.getByRole('link',{name:'View Fixture shirt',exact:true});
  await card.click();
  const loading = page.locator('.product-overlay .product-loading');
  await loading.waitFor();
  if(await page.getByText('Loading from STREET…',{exact:true}).count()) throw Error('Generic loading text');
  await page.screenshot({path:'/private/tmp/product-loading-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  if(await loading.locator('.skeleton-block').first().evaluate(el=>getComputedStyle(el).animationName) !== 'none') throw Error('Reduced motion ignored');
  await page.screenshot({path:'/private/tmp/product-loading-mobile.png'});
  for (let i=0; !release && i<500; i++) await new Promise(resolve=>setTimeout(resolve,10));
  if (!release) throw Error('Product request did not start');
  release(); release = null;
  await page.getByText('Fixture description',{exact:true}).waitFor();
  if(await loading.count()) throw Error('Skeleton did not clear');
  fail = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await loading.waitFor();
  await page.getByText('Updating product options and availability…',{exact:true}).waitFor();
  if(await page.getByRole('button',{name:'Add to bag',exact:true}).count()) throw Error('Stale purchase action');
  for (let i=0; !release && i<500; i++) await new Promise(resolve=>setTimeout(resolve,10));
  if (!release) throw Error('Product request did not start');
  release(); release = null;
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
  if(await loading.count()) throw Error('Error hidden by skeleton');
  fail = false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await loading.waitFor();
  for (let i=0; !release && i<500; i++) await new Promise(resolve=>setTimeout(resolve,10));
  if (!release) throw Error('Product request did not start');
  release(); release = null;
  await loading.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Black',exact:true}).waitFor();
  return 'PASS: initial and refresh skeletons, error/retry, reduced motion, desktop/mobile';
}

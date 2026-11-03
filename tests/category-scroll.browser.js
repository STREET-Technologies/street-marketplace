async (page) => {
  await page.unrouteAll();
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const vendorId='c7965184-84c3-40ef-9d97-c50468c37882',locationGid='gid://shopify/Location/90313228547';
  const categories=Array.from({length:24},(_,i)=>`Category ${String(i+1).padStart(2,'0')}`);
  await page.route('**/api/**', async route => {
    const u=new URL(route.request().url());
    if(u.pathname==='/api/auth/session') return route.fulfill({json:{user:null}});
    if(u.pathname==='/api/catalogue/browse') {
      const filtered=!!u.searchParams.get('productType');
      await new Promise(r=>setTimeout(r,250));
      return route.fulfill({json:{products:Array.from({length:filtered?2:12},(_,i)=>({id:vendorId,title:`${filtered?'Filtered':'All'} product ${i+1}`,price:25,image:null,vendorId,locationGid,productType:'Clothing'})),page:1,total:filtered?2:12,totalPages:1,facets:categories.map(productType=>({productType,count:1}))}});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:4319/?'+new URLSearchParams({view:'catalogue',vendorId,locationGid,shop:'Long catalogue'}));
  await page.getByRole('link',{name:'All product 1',exact:true}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,450));
  const nav=page.getByRole('navigation',{name:'Product categories'});
  await nav.evaluate(el=>el.scrollTop=el.scrollHeight);
  await nav.hover();
  const beforeWheel=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,600);
  await page.waitForTimeout(150);
  if(await page.evaluate(()=>scrollY)<=beforeWheel) throw Error('Scrolling past the category list did not continue down the page');
  await nav.getByRole('link',{name:'Category 24',exact:true}).click();
  await page.getByRole('link',{name:'Filtered product 1',exact:true}).waitFor();
  await page.waitForTimeout(100);
  const geometry=await page.evaluate(()=>({results:document.querySelector('.browse-results').getBoundingClientRect().top,header:document.querySelector('.marketplace-header').getBoundingClientRect().bottom,sidebar:document.querySelector('.catalogue-categories').scrollTop}));
  if(geometry.results<geometry.header||geometry.results>geometry.header+40) throw Error('New results are not aligned below sticky header: '+JSON.stringify(geometry));
  if(geometry.sidebar<100) throw Error('Category sidebar lost its own scroll position');
  const y=await page.evaluate(()=>scrollY);
  await nav.getByRole('link',{name:'Category 23',exact:true}).click();
  await page.waitForURL(/productType=Category\+23/);
  await page.getByRole('link',{name:'Filtered product 1',exact:true}).waitFor();
  if(Math.abs(await page.evaluate(()=>scrollY)-y)>2) throw Error('Already-visible results caused an unnecessary jump');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await nav.getByRole('link',{name:'Category 22',exact:true}).click();
  await page.waitForURL(/productType=Category\+22/);
  await page.getByRole('link',{name:'Filtered product 1',exact:true}).waitFor();
  if(await page.evaluate(()=>scrollY)>20) throw Error('Mobile pill selection scrolled the page');
  return {geometry,passed:'Desktop result alignment, sidebar position, no redundant jump and mobile pills'};
}

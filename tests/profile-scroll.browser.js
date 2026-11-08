// Run with Playwright CLI against localhost:4319; account reads are mocked.
async page => {
  await page.unrouteAll();
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const owner='576fa9b6-3775-426c-86d5-5ef8710c35e9';
  await page.route('**/api/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session') return route.fulfill({json:{user:{id:owner,firstName:'Test',lastName:'Customer',phone:'+447700900123',email:'test@example.com'}}});
    if(path==='/api/customer-context') return route.fulfill({json:{userId:owner,favourites:[],addresses:Array.from({length:20},(_,i)=>({id:`address-${i}`,label:`Home ${i+1}`,line1:`${i+1} Test Street`,city:'London',postcode:'E1 6AN',coordinates:{latitude:51.52,longitude:-0.07},isDefault:i===0}))}});
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:4319/account');
  const addresses=page.getByRole('tab',{name:'My addresses',exact:true});
  const details=page.getByRole('tab',{name:'Personal details',exact:true});
  await addresses.click();
  await page.getByRole('heading',{name:'Home 20',exact:true}).waitFor();
  const aligned=async()=>{
    const geometry=await page.evaluate(()=>({top:document.querySelector('.customer-tab-layout > [role="tabpanel"]:not([hidden])').getBoundingClientRect().top,header:document.querySelector('.marketplace-header').getBoundingClientRect().bottom}));
    if(geometry.top<geometry.header-1||geometry.top>geometry.header+40) throw Error('Panel not aligned: '+JSON.stringify(geometry));
  };
  await page.evaluate(()=>window.scrollTo(0,600));
  await addresses.click();
  await aligned();
  const y=await page.evaluate(()=>scrollY);
  await addresses.click();
  if(Math.abs(await page.evaluate(()=>scrollY)-y)>2) throw Error('Visible panel jumped unnecessarily');
  await page.evaluate(()=>window.scrollTo(0,600));
  await details.click();
  await aligned();
  await addresses.click();
  await page.evaluate(()=>window.scrollTo(0,600));
  await addresses.focus();
  await addresses.press('ArrowUp');
  if(await details.getAttribute('aria-selected')!=='true') throw Error('Keyboard did not select details');
  await aligned();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await addresses.click();
  if(await page.evaluate(()=>scrollY)>20) throw Error('Mobile tabs scrolled unexpectedly');
  return 'PASS: Profile switching/reselection, keyboard, no redundant scroll and mobile tabs';
}

// Run with the Playwright CLI against localhost:4319. All APIs are mocked.
async page => {
  const owner='576fa9b6-3775-426c-86d5-5ef8710c35e9';
  const vendorId='e13ad453-943c-4861-891a-feae35a805d4';
  const outletId='0eb52280-293f-480e-ad39-ffa76970c1e1';
  const locationGid='gid://shopify/Location/81968234566';
  const product={id:owner,title:'Fixture shirt',description:'Fixture description',images:[],
    options:[{name:'Size',values:['S','M']},{name:'Colour',values:['Black','White']}],
    variants:[{id:'123',title:'S / Black',inventory:5,price:25},{id:'124',title:'M / Black',inventory:5,price:25},{id:'125',title:'S / White',inventory:2,price:25},{id:'126',title:'M / White',inventory:0,price:25}]};
  await page.unrouteAll();
  await page.route('**/api/**', route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth/session') return route.fulfill({json:{user:{id:owner}}});
    if(url.pathname==='/api/customer-context') return route.fulfill({json:{userId:owner,addresses:[],favourites:[]}});
    if(url.pathname==='/api/catalogue/browse') return route.fulfill({json:url.searchParams.get('kind')==='product'?product:{facets:[],products:[{...product,price:25,image:null,vendorId,outletId,locationGid,productType:'Shirts',shopName:'Fixture',outletName:'London'}],page:1,total:1,totalPages:1}});
    return route.fulfill({status:503,json:{error:'Fixture: unavailable'}});
  });
  const url='http://localhost:4319/?'+new URLSearchParams({view:'catalogue',vendorId,outletId,locationGid,shop:'Fixture'});
  await page.goto(url);
  await page.evaluate(owner=>localStorage.removeItem(`street:staging:cart:v1:${owner}`),owner);
  await page.reload();
  await page.getByRole('link',{name:'View Fixture shirt',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Product details',exact:true});
  await dialog.getByRole('button',{name:'Black',exact:true}).click();
  await dialog.getByRole('button',{name:'S',exact:true}).click();
  await dialog.getByText('In Stock (5 available)',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Add to bag',exact:true}).click();
  await dialog.getByRole('link',{name:'View Bag and Checkout',exact:true}).waitFor();
  if(await dialog.getByText('Added to your bag.',{exact:false}).count()) throw Error('Duplicate success copy');
  await dialog.getByRole('button',{name:'M',exact:true}).click();
  await dialog.getByRole('button',{name:'Add to bag',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'S',exact:true}).click();
  await dialog.getByRole('button',{name:'White',exact:true}).click();
  await dialog.getByRole('button',{name:'Add to bag',exact:true}).waitFor();
  await dialog.getByText('Low Stock (2 available)',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'M, Out of stock',exact:true}).click();
  await dialog.getByText('Out of Stock',{exact:true}).waitFor();
  if (!(await dialog.getByRole('button',{name:'Currently unavailable'}).isDisabled())) throw Error('Out-of-stock enabled');
  await dialog.getByRole('button',{name:'S',exact:true}).click();
  await dialog.getByRole('button',{name:'Black',exact:true}).click();
  await dialog.getByRole('link',{name:'View Bag and Checkout',exact:true}).click();
  await page.waitForURL('**/bag');
  if(await page.locator('dialog[open]').count()) throw Error('Overlay remained open');
  const cart=await page.evaluate(owner=>JSON.parse(localStorage.getItem(`street:staging:cart:v1:${owner}`)),owner);
  if(cart.lines.length!==1||cart.lines[0].variantId!=='123'||cart.lines[0].quantity!==1) throw Error('Wrong bag or duplicate add');
  return 'PASS: add changes CTA; size/colour changes reset action; bag link closes overlay; no duplicate quantity';
}

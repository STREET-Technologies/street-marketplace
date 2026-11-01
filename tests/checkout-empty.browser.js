async (page) => {
  const owner = "576fa9b6-3775-426c-86d5-5ef8710c35e9",
    addressId = "17e49931-5ad0-44f8-895a-393752d2babb",
    id = "4a29e85a-92fd-47da-88a2-96fcbd78b557";
  const cart = {
    vendorId: "e13ad453-943c-4861-891a-feae35a805d4",
    outletId: "0eb52280-293f-480e-ad39-ffa76970c1e1",
    shopName: "Gymshark",
    branch: "Regent Street",
    lines: [
      {
        productId: owner,
        variantId: "1234",
        quantity: 1,
        title: "Fixture shirt",
        variantTitle: "M",
        image: null,
        unitPrice: 25,
      },
    ],
  };
  const key = `street:staging:checkout:v1:${owner}`,
    bagKey = `street:staging:cart:v1:${owner}`;
  const address = {
    id: addressId,
    label: "Home",
    line1: "1 Test Street",
    line2: null,
    city: "London",
    postcode: "W1F 9PT",
    isDefault: true,
    coordinates: { latitude: 51.51, longitude: -0.13 },
  };
  await page.unrouteAll();
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({json:{user:{id:owner}}});
    if (path === "/api/customer-context")
      return route.fulfill({json:{userId:owner,addresses:[address],favourites:[]}});
    return route.fulfill({status:500,json:{error:"Unexpected fixture request"}});
  });
  await page.goto("http://localhost:4319/bag");
  await page.evaluate(({key, bagKey, cart, owner, addressId, id}) => {
    localStorage.removeItem(bagKey);
    localStorage.setItem(key, JSON.stringify({owner, id, attemptKey:id, completionHandled:true,
      intent:{vendorId:cart.vendorId,outletId:cart.outletId,addressId,lines:cart.lines.map(({productId,variantId,quantity})=>({productId,variantId,quantity}))}, snapshot:cart}));
  }, {key,bagKey,cart,owner,addressId,id});
  let release;
  const pending = new Promise(resolve => release = resolve);
  await page.route("**/api/checkout/attempts**", async route => {
    await pending;
    await route.fulfill({json:{userId:owner,id,status:"completed",orderId:"ST-000123"}});
  });
  await page.reload();
  await page.getByRole("heading", {name:"Your bag is empty",exact:true}).waitFor();
  await page.waitForTimeout(300);
  const controls = await page.locator(".checkout-actions").count();
  release();
  if (controls) throw Error("Stale checkout controls flash while saved status is pending");
  await page.waitForTimeout(300);
  if (await page.locator(".checkout-actions").count()) throw Error("Completed checkout controls remain in empty bag");
  await page.unroute("**/api/checkout/attempts**");
  await page.route("**/api/checkout/attempts**", route => route.fulfill({json:{
    userId:owner,id,status:"ready",orderId:"ST-000123",
    checkoutUrl:"https://gymshark-10024.myshopify.com/checkouts/cn/fixture"
  }}));
  await page.reload();
  await page.getByRole("button", {name:"Resume checkout",exact:true}).waitFor();
  await page.unroute("**/api/checkout/attempts**");
  await page.route("**/api/checkout/attempts**", route => route.fulfill({status:503,json:{error:"Status unavailable"}}));
  await page.reload();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", {name:"Check order status",exact:true}).waitFor();
  return "PASS: pending checkout and status-error recovery remain visible; restored completed checkout stays hidden before and after status verification";
}

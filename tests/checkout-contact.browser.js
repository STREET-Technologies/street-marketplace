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
  let currentOwner = owner,
    conflict = false,
    notStarted = false;
  let status = "ready",
    lose = true;
  const posts = [],
    updates = [];
  let contact = { email: "relay@privaterelay.appleid.com", phone: "" },
    saveFails = false;
  lose = false;

  await page.unrouteAll();
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({
        json: { user: { id: currentOwner, ssoProvider: "apple", ...contact } },
      });
    if (path === "/api/profile") {
      updates.push(req.postDataJSON());
      if (saveFails)
        return route.fulfill({
          status: 409,
          json: { error: "These details are already used by another account." },
        });
      contact = { ...contact, ...req.postDataJSON() };
      return route.fulfill({
        json: { user: { id: currentOwner, ssoProvider: "apple", ...contact } },
      });
    }
    if (path === "/api/customer-context")
      return route.fulfill({
        json: { userId: currentOwner, addresses: [address], favourites: [] },
      });
    if (path === "/api/cart/check") {
      const body = req.postDataJSON();
      return route.fulfill({
        json: {
          userId: owner,
          addressId,
          checkedAt: new Date().toISOString(),
          delivery: { status: "available", isOpen: true },
          deliveryFee: 9.99,
          total: 34.99,
          subtotal: 25,
          lines: body.lines.map((l) => ({
            ...l,
            title: "Fixture shirt",
            variantTitle: "M",
            image: null,
            unitPrice: 25,
            inventory: 10,
            issue: null,
          })),
        },
      });
    }
    if (path === "/api/checkout/attempts") {
      if (req.method() === "POST") {
        posts.push(req.postDataJSON());
        if (notStarted)
          return route.fulfill({
            status: 400,
            json: { error: "Review bag", code: "CHECKOUT_NOT_STARTED" },
          });
        if (conflict)
          return route.fulfill({
            status: 409,
            json: { error: "Resume existing checkout", attemptId: id },
          });
        if (lose) {
          lose = false;
          return route.abort("failed");
        }
      }
      return route.fulfill({
        json: {
          userId: owner,
          id,
          status,
          orderId: "123",
          ...(status === "ready"
            ? {
                checkoutUrl:
                  "https://gymshark-10024.myshopify.com/checkouts/cn/fixture",
              }
            : {}),
        },
      });
    }
    return route.fulfill({
      status: 500,
      json: { error: "Unexpected fixture request" },
    });
  });
  await page.route("https://gymshark-10024.myshopify.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Fixture hosted checkout</h1>",
    }),
  );

  async function openBag() {
    await page.goto("http://localhost:4322/bag");
    await page.evaluate(
      ({ bagKey, key, cart }) => {
        localStorage.setItem(bagKey, JSON.stringify(cart));
        localStorage.removeItem(key);
      },
      { bagKey, key, cart },
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Choose address", exact: true })
      .click();
    await page.getByRole("button", { name: /Home.*Account default/ }).click();
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
  }
  await openBag();
  await page
    .getByRole("heading", { name: "Add your mobile number" })
    .waitFor({ timeout: 4000 });
  if (
    posts.length ||
    (await page.evaluate((key) => localStorage.getItem(key), key))
  )
    throw Error("Started checkout before collecting mobile");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  if (updates.length || posts.length) throw Error("Cancellation mutated data");
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.getByLabel("Mobile number", { exact: true }).fill("+447700900123");
  await page.screenshot({ path: "output/playwright/tt553-contact.png", fullPage: true });
  saveFails = true;
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "already used" }).waitFor();
  if (posts.length) throw Error("Started despite failed profile save");
  saveFails = false;
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Fixture hosted checkout" })
    .waitFor();
  if (posts.length !== 1 || contact.phone !== "+447700900123")
    throw Error("Did not save and start exactly once");
  for (const missing of [
    { email: "", phone: "+447700900123" },
    { email: "", phone: "" },
  ]) {
    contact = missing;
    await openBag();
    await page
      .getByLabel("Email address", { exact: true })
      .fill("buyer@example.test");
    if (!missing.phone)
      await page
        .getByLabel("Mobile number", { exact: true })
        .fill("+447700900123");
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Fixture hosted checkout" })
      .waitFor();
  }
  if (posts.length !== 3)
    throw Error("Missing-email scenarios did not start exactly once");
  await openBag();
  await page
    .getByRole("heading", { name: "Fixture hosted checkout" })
    .waitFor();
  if (posts.length !== 4) throw Error("Complete profile was blocked");
  return {
    passed: true,
    checkouts: posts.length,
    profileWrites: updates.length,
  };
}

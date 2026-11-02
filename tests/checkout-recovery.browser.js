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
  const posts = [];
  await page.unrouteAll();
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({ json: { user: { id: currentOwner } } });
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

  lose = false;
  const url = "http://localhost:4319/bag";
  await page.goto(url);
  async function seed(savedStatus) {
    status = savedStatus;
    await page.evaluate(
      ({ key, bagKey, cart, owner, addressId, id, savedStatus }) => {
        localStorage.setItem(bagKey, JSON.stringify(cart));
        localStorage.setItem(
          key,
          JSON.stringify({
            owner,
            attemptKey: id,
            ...(savedStatus === "not-started"
              ? { notStarted: true }
              : { id, completionHandled: true }),
            intent: {
              vendorId: cart.vendorId,
              outletId: cart.outletId,
              addressId,
              lines: cart.lines.map(({ productId, variantId, quantity }) => ({
                productId,
                variantId,
                quantity,
              })),
            },
            snapshot: cart,
          }),
        );
      },
      { key, bagKey, cart, owner, addressId, id, savedStatus },
    );
    await page.reload();
  }
  for (const previous of ["completed", "failed", "cancelled", "not-started"]) {
    await seed(previous);
    await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
    if (await page.getByRole("button", { name: "Done", exact: true }).count())
      throw Error("Done step remains");
    await page
      .getByRole("button", { name: "Choose address", exact: true })
      .click();
    await page.getByRole("button", { name: /Home.*Account default/ }).click();
    const before = posts.length;
    status = "preparing";
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
    await page
      .getByText("Preparing your checkout. Check its status in a moment.", {
        exact: true,
      })
      .waitFor();
    if (posts.length !== before + 1 || posts.at(-1).attemptKey === id)
      throw Error("Checkout did not start exactly one fresh attempt");
  }
  await seed("uncertain");
  await page
    .getByRole("button", { name: "Resume checkout", exact: true })
    .waitFor();
  const before = posts.length;
  await page
    .getByRole("button", { name: "Choose address", exact: true })
    .click();
  await page.getByRole("button", { name: /Home.*Account default/ }).click();
  await page
    .getByRole("button", { name: "Resume checkout", exact: true })
    .click();
  await page.waitForTimeout(200);
  if (posts.length !== before)
    throw Error("Uncertain checkout created a replacement");
  if (
    await page
      .getByText("Final shipping and discounts are confirmed at checkout.", {
        exact: true,
      })
      .count()
  )
    throw Error("Redundant shipping note remains");
  return "PASS: completed/failed/cancelled/not-started recovery starts one fresh checkout without Done; uncertain recovery stays read-only";
};

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
  await page.goto("http://localhost:4319/bag");
  await page.evaluate(
    ({ bagKey, cart }) => localStorage.setItem(bagKey, JSON.stringify(cart)),
    { bagKey, cart },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Checkout coming later", exact: true })
    .waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Checkout coming later", exact: true })
      .isDisabled())
  )
    throw Error("Gate enabled");
  await page.goto("http://localhost:4320/bag");
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
  await page
    .getByRole("alert")
    .filter({ hasText: "Your bag is kept" })
    .waitFor();
  const persisted = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    key,
  );
  if (!persisted?.attemptKey || posts.length !== 1)
    throw Error("Missing pre-mutation persistence or implicit retry");
  await page
    .getByRole("button", { name: "Resume checkout", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Fixture hosted checkout" })
    .waitFor();
  if (
    posts.length !== 2 ||
    JSON.stringify(posts[0]) !== JSON.stringify(posts[1])
  )
    throw Error("Retry changed intent/key");
  status = "uncertain";
  await page.goto("http://localhost:4320/bag");
  await page
    .getByText("Checkout is being confirmed.", { exact: false })
    .waitFor();
  if (
    posts.length !== 2 ||
    !(await page.evaluate((key) => localStorage.getItem(key), bagKey))
  )
    throw Error("Return mutated or lost bag");
  const newer = { ...cart, lines: [{ ...cart.lines[0], quantity: 2 }] };
  await page.evaluate(
    ({ bagKey, newer }) => localStorage.setItem(bagKey, JSON.stringify(newer)),
    { bagKey, newer },
  );
  status = "completed";
  await page.reload();
  await page.getByText("Order placed.", { exact: false }).waitFor();
  if (
    (
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        bagKey,
      )
    ).lines[0].quantity !== 2
  )
    throw Error("Newer bag cleared");
  await page.screenshot({
    path: "/private/tmp/street-checkout-completed-newer-bag.png",
    fullPage: true,
  });
  // A matching submitted snapshot is cleared, only after canonical completion.
  await page.evaluate(
    ({ bagKey, key, cart }) => {
      localStorage.setItem(bagKey, JSON.stringify(cart));
      const attempt = JSON.parse(localStorage.getItem(key));
      attempt.completionHandled = false;
      localStorage.setItem(key, JSON.stringify(attempt));
    },
    { bagKey, key, cart },
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Your bag is empty", exact: true })
    .waitFor();
  if (await page.evaluate((key) => localStorage.getItem(key), bagKey))
    throw Error("Confirmed exact bag not cleared");
  // Recover an owned attempt from another device without assuming its bag snapshot.
  conflict = true;
  status = "uncertain";
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
  await page
    .getByText("Checkout is being confirmed.", { exact: false })
    .waitFor();
  const recovered = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    key,
  );
  if (!recovered.recovered || recovered.id !== id)
    throw Error("Owned conflict did not recover");
  status = "completed";
  await page.reload();
  await page.getByText("Order placed.", { exact: false }).waitFor();
  if (!(await page.evaluate((key) => localStorage.getItem(key), bagKey)))
    throw Error("Recovered unknown snapshot cleared bag");
  conflict = false;
  notStarted = true;
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.reload();
  await page
    .getByRole("button", { name: "Choose address", exact: true })
    .click();
  await page.getByRole("button", { name: /Home.*Account default/ }).click();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).waitFor();
  if (
    !(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key))
      .notStarted
  )
    throw Error("Definitive preflight not retained for explicit reset");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Checkout", exact: true }).waitFor();
  if (await page.evaluate((key) => localStorage.getItem(key), key))
    throw Error("Explicit reset failed");
  currentOwner = addressId;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("street:session-changed")),
  );
  await page
    .getByRole("heading", { name: "Your bag is empty", exact: true })
    .waitFor();
  if (await page.getByText("Order placed.", { exact: false }).count())
    throw Error("Prior account checkout shown");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  return "PASS disabled gate; stable pre-mutation key; lost-response explicit same-intent retry; same-tab hosted handoff; uncertain return has no mutation; completed preserves newer bag and clears exact snapshot; owned-conflict recovery preserves unknown snapshot; account isolation; mobile overflow absent";
}

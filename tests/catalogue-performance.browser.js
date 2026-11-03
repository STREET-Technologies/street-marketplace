async (page) => {
  const vendorId = "c7965184-84c3-40ef-9d97-c50468c37882",
    productId = "ffaf20c2-6779-49c8-b1aa-e378c00030b1",
    locationGid = "gid://shopify/Location/90313228547";
  const image =
    "https://cdn.shopify.com/s/files/1/0813/9856/3075/files/AM25-SC-NEW-ASTRID-I-A-SG_3_57d6b349-f209-49ec-bbfa-48ffe8a47507.jpg?v=1775735495";
  let detailRequests = 0,
    listRequests = 0,
    shopRequests = 0,
    fail = false,
    stock = 6;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.unrouteAll();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/auth/session")
      return route.fulfill({ json: { user: { id: vendorId } } });
    if (u.pathname === "/api/customer-context")
      return route.fulfill({
        json: { userId: vendorId, addresses: [], favourites: [] },
      });
    if (u.pathname === "/api/catalogue/vendors") {
      shopRequests++;
      return route.fulfill({
        json: {
          outlets: [
            {
              vendorId,
              outletId: vendorId,
              locationGid,
              name: "Fixture",
              outletName: "Soho",
              category: "Fashion",
              image,
              logo: null,
              postcode: "W1F 9PT",
              address: "1 Test Street",
              distanceMiles: 0.1,
              isOnline: true,
            },
          ],
          categories: ["Fashion"],
          total: 1,
          totalPages: 1,
          page: 1,
        },
      });
    }
    if (u.pathname === "/api/catalogue/browse") {
      if (u.searchParams.get("kind") === "product") {
        detailRequests++;
        await new Promise((r) => setTimeout(r, 600));
        if (fail)
          return route.fulfill({
            status: 503,
            json: { error: "Please try again." },
          });
        return route.fulfill({
          json: {
            id: productId,
            title: "Performance fixture",
            images: Array.from(
              { length: 6 },
              (_, i) => image + "&fixture=" + i,
            ),
            description: "Test product details",
            variants: [{ id: "1", title: "M", price: 25, inventory: stock }],
            options: [{ name: "Size", values: ["M"] }],
          },
        });
      }
      listRequests++;
      await new Promise((r) => setTimeout(r, 300));
      return route.fulfill({
        json: {
          products: [
            {
              id: productId,
              title: "Performance fixture",
              image,
              price: 25,
              vendorId,
              locationGid,
              productType: "Clothing",
            },
          ],
          page: 1,
          total: 1,
          totalPages: 1,
          facets: [],
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  const expect = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const base = "http://localhost:4319/";
  await page.goto(base + "?view=shops");
  await page
    .getByRole("link", { name: "Explore Fixture, Soho", exact: true })
    .waitFor();
  const initialShopRequests = shopRequests;
  await page
    .getByRole("link", { name: "Explore Fixture, Soho", exact: true })
    .click();
  const card = page.getByRole("link", {
    name: "View Performance fixture",
    exact: true,
  });
  await card.waitFor();
  await card.hover();
  await page.waitForTimeout(200);
  expect(detailRequests === 1, "Hover must begin one detail request");
  await card.click();
  const started = Date.now();
  await page
    .getByRole("heading", { name: "Performance fixture", exact: true })
    .waitFor();
  const headingMs = Date.now() - started;
  expect(
    headingMs < 300,
    "Existing title should show before the delayed detail response",
  );
  await page.getByText("Test product details", { exact: true }).waitFor();
  expect(detailRequests === 1, "Opening must share hover request");
  expect(
    !!(await page.locator(".gallery-stage img").getAttribute("srcset")),
    "Gallery must request responsive images",
  );
  expect(
    (await page.locator(".gallery-choices img").count()) === 5,
    "Keep five preview images",
  );
  await page
    .getByRole("button", { name: "Next product image", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next product image", exact: true })
    .press("ArrowRight");
  expect(
    (await page.locator(".gallery-position").textContent())?.includes("3 / 6"),
    "Gallery keyboard navigation must remain available",
  );
  await page
    .getByRole("button", { name: "Close product details", exact: true })
    .click();
  await card.click();
  await page.getByText("Test product details", { exact: true }).waitFor();
  expect(
    detailRequests === 1,
    "Immediate reopening should reuse recent details",
  );
  await page
    .getByRole("button", { name: "Close product details", exact: true })
    .click();
  await page.goBack();
  await page
    .getByRole("link", { name: "Explore Fixture, Soho", exact: true })
    .waitFor();
  expect(
    shopRequests === initialShopRequests,
    "Returning to shops should reuse the directory",
  );
  await page
    .getByRole("link", { name: "Explore Fixture, Soho", exact: true })
    .click();
  await card.waitFor();
  expect(listRequests === 1, "Returning to a shop should reuse the catalogue");
  // Age snapshots without waiting ten real seconds, then ensure stale commerce
  // controls remain unavailable until a fresh response has arrived.
  await page.evaluate(() => {
    const original = Date.now;
    Date.now = () => original() + 11_000;
  });
  stock = 0;
  fail = true;
  await card.click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  expect(
    (await page
      .getByRole("button", { name: "Add to bag", exact: true })
      .count()) === 0,
    "Stale stock must not enable Add to bag after a failed refresh",
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("Out of Stock", { exact: true }).waitFor();
  expect(
    await page
      .getByRole("button", { name: "Currently unavailable", exact: true })
      .isDisabled(),
    "Fresh out-of-stock response must disable purchasing",
  );
  await page
    .getByRole("button", { name: "Close product details", exact: true })
    .click();
  const beforeReset = detailRequests;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("street:session-changed")),
  );
  await card.waitFor();
  await card.click();
  await page.getByText("Test product details", { exact: true }).waitFor();
  expect(
    detailRequests > beforeReset,
    "Session change must clear product snapshots",
  );
  await page
    .getByRole("button", { name: "Close product details", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.click();
  await page
    .getByRole("heading", { name: "Performance fixture", exact: true })
    .waitFor();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile page must not overflow",
  );
  expect(errors.length === 0, "Browser errors: " + errors.join("; "));
  await page.screenshot({ path: "/private/tmp/street-performance-mobile.png" });
  return {
    headingMs,
    detailRequests,
    listRequests,
    shopRequests,
    passed:
      "Prefetch/deduplication, back navigation, responsive images, stale stock failure/retry, session reset, mobile and keyboard gallery",
  };
}

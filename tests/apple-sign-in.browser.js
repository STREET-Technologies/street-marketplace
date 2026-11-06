async (page) => {
  await page.unrouteAll();
  let signedIn = false,
    fail = false,
    starts = 0,
    finishes = 0,
    links = 0;
  const customer = {
    id: "existing-apple-user",
    firstName: "Apple",
    lastName: "Customer",
    email: "relay@example.test",
    phone: null,
    ssoProvider: "apple",
    appleConnected: true,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({ json: { user: signedIn ? customer : null } });
    if (path === "/api/customer-context")
      return route.fulfill({
        json: { userId: customer.id, addresses: [], favourites: [] },
      });
    if (path === "/api/auth/google/start")
      return route.fulfill({ json: { enabled: false } });
    if (path === "/api/auth/apple/start") {
      starts++;
      return route.fulfill({
        json: {
          enabled: true,
          clientId: "london.street.web",
          redirectUri:
            "https://marketplace-staging.street.london/api/auth/apple/callback",
          challengeId: "11111111-1111-4111-8111-111111111111",
          nonce: "n".repeat(43),
          state: "s".repeat(43),
          expiresIn: 300,
        },
      });
    }
    if (path === "/api/auth/apple") {
      finishes++;
      if (fail)
        return route.fulfill({
          status: 409,
          json: {
            error:
              "Confirm Apple in Personal details while signed in to your existing STREET account.",
          },
        });
      signedIn = true;
      return route.fulfill({ json: { user: customer } });
    }
    if (path === "/api/auth/apple/link") {
      links++;
      return route.fulfill({ json: { linked: true } });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route("https://appleid.cdn-apple.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.AppleID={auth:{init(config){window.appleConfig=config;},renderButton(){document.getElementById('appleid-signin').innerHTML='<button type="button">Continue with Apple</button>';},async signIn(){window.appleCalls=(window.appleCalls||0)+1;if(window.appleCancel){window.appleCancel=false;throw {error:'user_cancelled_authorize'};}return {authorization:{code:'fixture-code',id_token:'signed.apple.token',state:window.appleConfig.state}};}}};
  `,
    }),
  );
  await page.goto("http://localhost:4319/account");
  const button = page.getByRole("button", {
    name: "Continue with Apple",
    exact: true,
  });
  await button.waitFor();
  await page.evaluate(() => {
    window.appleCancel = true;
  });
  await button.click();
  await page.waitForFunction(
    () =>
      document.querySelector("#appleid-signin") &&
      !document.querySelector("#appleid-signin").inert,
  );
  if (finishes !== 0) throw Error("Cancellation submitted a credential");
  if (await page.locator(".apple-sign-in [role=alert]").count())
    throw Error("Cancellation displayed an error");
  fail = true;
  await button.click();
  await page.getByRole("alert").filter({ hasText: "Confirm Apple" }).waitFor();
  await page.getByRole("button", { name: "Try Apple again" }).click();
  fail = false;
  await button.waitFor();
  await button.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Personal details", exact: true })
    .waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "Apple connected" })
    .waitFor();
  if (
    await page
      .getByRole("checkbox", { name: "Connect Apple to this STREET account" })
      .count()
  )
    throw Error("Connected account offered Apple linking");
  // A different, unconnected account must retain the explicit linking flow.
  customer.appleConnected = false;
  customer.ssoProvider = "google";
  await page.reload();
  await page
    .getByRole("checkbox", { name: "Connect Apple to this STREET account" })
    .waitFor();
  if (!(await page.locator("#appleid-signin").evaluate((el) => el.inert)))
    throw Error("Link button usable before confirmation");
  await page
    .getByRole("checkbox", { name: "Connect Apple to this STREET account" })
    .check();
  await button.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Apple connected" })
    .waitFor();
  if (links !== 1 || finishes !== 2)
    throw Error(
      "Incorrect submission counts " + JSON.stringify({ links, finishes }),
    );
  await page.setViewportSize({ width: 320, height: 850 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await button.waitFor();
  return { passed: true, starts, finishes, links };
};

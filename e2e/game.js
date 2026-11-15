// Full game across four phone-sized browser contexts, driven by `playwright-cli run-code`.
// One phone is "locked" mid-turn (context closed) and comes back by picking its name; a fifth player joins late.
async (page) => {
  const BASE = "http://saladbowl.gs.localhost:1355"
  const browser = page.context().browser()
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const p = await ctx.newPage()
    p.on("dialog", (d) => d.accept())
    return { ctx, p }
  }
  const log = []
  const fail = (m) => {
    throw new Error(`E2E FAIL: ${m}\n${log.join("\n")}`)
  }
  const sleep = (ms) => page.waitForTimeout(ms)
  const visible = async (p, role, name) => {
    try {
      return await p.getByRole(role, { name, exact: true }).isVisible()
    } catch {
      return false
    }
  }

  // host signs in and creates a game
  const host = await phone()
  await host.p.goto(BASE + "/")
  await host.p.getByLabel("Host password").fill("let-me-in-please")
  await host.p.getByRole("button", { name: "Sign in" }).click()
  await host.p.getByLabel("Your name").fill("Sid")
  await host.p.getByRole("button", { name: "Start a new game" }).click()
  await host.p.getByText("Lobby").waitFor()
  const label = await host.p.locator("svg[data-qr]").getAttribute("aria-label")
  const invite = label.replace("QR code for ", "")
  log.push(`invite ${invite}`)

  // rules: 2 words each, 10 s turns
  for (let i = 0; i < 4; i++) await host.p.getByRole("button", { name: "Less words each" }).click()
  for (let i = 0; i < 10; i++) await host.p.getByRole("button", { name: "Less seconds per turn" }).click()

  const phones = { Sid: host }
  for (const name of ["Anu", "Ben", "Cy"]) {
    const ph = await phone()
    await ph.p.goto(invite)
    await ph.p.getByLabel("Your name").fill(name)
    await ph.p.getByRole("button", { name: "Join game" }).click()
    await ph.p.getByText("Your words").waitFor()
    phones[name] = ph
  }
  for (const [name, ph] of Object.entries(phones)) {
    for (let i = 0; i < 2; i++) {
      await ph.p.getByLabel("Add a word").fill(`${name} thing ${i + 1}`)
      await ph.p.getByLabel("Add a word").press("Enter")
      await sleep(150)
    }
  }
  await host.p.getByRole("button", { name: "Make teams" }).click({ timeout: 5000 })
  await host.p.getByRole("button", { name: "Start game" }).click()
  log.push("started")

  let lockedDone = false
  let lateJoined = false
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const entries = Object.entries(phones)
    const ended = []
    for (const [, ph] of entries) ended.push(await ph.p.getByText(/wins$|It's a tie/).isVisible().catch(() => false))
    if (ended.every(Boolean)) break

    let acted = false
    for (const [name, ph] of entries) {
      if (await visible(ph.p, "button", "Start my turn")) {
        log.push(`${name} starts a turn`)
        await ph.p.getByRole("button", { name: "Start my turn" }).click()
        await ph.p.getByRole("button", { name: "Got it", exact: true }).waitFor()
        const word = await ph.p.locator(".slip span").textContent()
        for (const [other, op] of entries)
          if (other !== name && (await op.p.content()).includes(word)) fail(`${other} could see the card "${word}"`)

        if (name === "Ben" && !lockedDone) {
          // Ben's phone locks mid-turn: the server must still end the turn on time
          await ph.p.getByRole("button", { name: "Got it", exact: true }).click()
          await ph.ctx.close()
          delete phones.Ben
          log.push("Ben's phone closed mid-turn")
          await host.p.getByRole("button", { name: "Host" }).waitFor()
          await host.p.getByRole("button", { name: "Done", exact: true }).waitFor({ timeout: 15_000 })
          await host.p.getByRole("button", { name: "Done", exact: true }).click()
          log.push("host confirmed Ben's review")
          const back = await phone()
          await back.p.goto(invite)
          await back.p.getByRole("button", { name: "I'm Ben" }).click()
          await back.p.getByText(/^Round \d/).waitFor()
          phones.Ben = back
          log.push("Ben rejoined by name")
          lockedDone = true
          if (!lateJoined) {
            const dee = await phone()
            await dee.p.goto(invite)
            await dee.p.getByLabel("Your name").fill("Dee")
            await dee.p.getByRole("button", { name: "Join game" }).click()
            await dee.p.getByText(/^Round \d/).waitFor()
            phones.Dee = dee
            lateJoined = true
            log.push("Dee joined late")
          }
        } else {
          for (let i = 0; i < 3; i++) {
            if (!(await visible(ph.p, "button", "Got it"))) break
            await ph.p.getByRole("button", { name: "Got it", exact: true }).click()
            await sleep(350)
          }
          await ph.p.getByRole("button", { name: "Done", exact: true }).waitFor({ timeout: 15_000 })
          await ph.p.getByRole("button", { name: "Done", exact: true }).click()
        }
        acted = true
        break
      }
    }
    if (!acted) await sleep(300)
  }

  const results = {}
  for (const [name, ph] of Object.entries(phones)) results[name] = await ph.p.getByText(/wins$|It's a tie/).isVisible().catch(() => false)
  if (!Object.values(results).every(Boolean)) fail(`not everyone reached the end screen: ${JSON.stringify(results)}`)
  if (!lockedDone || !lateJoined) fail("lock/late-join path never ran")
  const dee = await phones.Dee.p.getByText("Dee").count()
  log.push(`Dee mentioned on her end screen: ${dee}`)
  for (const ph of Object.values(phones)) await ph.ctx.close()
  return `E2E PASS\n${log.join("\n")}`
}

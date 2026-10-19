// Tests open the board from file:// in the bundled headless Chromium.
// No web server, no browser window, no report that opens by itself.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  },
});

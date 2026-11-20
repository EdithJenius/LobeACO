// Keep a neutral tab while closing report pages. Chromium must exit normally
// with session restore enabled to retain session-only merchant logins.
export async function closeShopContext(context) {
  if (!context) return;
  const tidy = async () => {
    const blank = context.pages().find(p => p.url() === 'about:blank') ?? await context.newPage();
    for (const page of context.pages()) {
      if (page !== blank && !page.isClosed()) await page.close();
    }
  };
  let timeout;
  try {
    // A stalled renderer can stop answering newPage/close. Still release the
    // owned profile through Chromium's normal browser shutdown.
    await Promise.race([tidy(), new Promise(resolve => { timeout = setTimeout(resolve, 4000); })]);
  } finally {
    clearTimeout(timeout);
    await context.close();
  }
}

// Only follow popups from this task's page in a shared merchant window.
const descendants = new WeakMap();
export function trackTaskPage(page) {
  const children = new Set();
  descendants.set(page, children);
  page.on?.('popup', popup => children.add(trackTaskPage(popup)));
  return page;
}

export async function closeTaskPage(page) {
  if (!page) return;
  try {
    if (!page.isClosed?.()) await page.close();
  } finally {
    for (const child of descendants.get(page) ?? []) await closeTaskPage(child);
    descendants.delete(page);
  }
}

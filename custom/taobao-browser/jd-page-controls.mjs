// Only observe the value written by the product's own copy button during this click.
// Never read the system clipboard, which could contain an unrelated value.
export async function clickJdProductCopy(frame, locator) {
  const pageUrl = new URL(frame.url());
  if (pageUrl.hostname !== 'wares-jdm.jd.com' || pageUrl.pathname !== '/ware/wareList') return null;
  const label = (await locator.textContent()).trim();
  if (label !== '分享' && label !== '复制链接') return null;
  let copyButton = locator;
  if (label === '分享') {
    // Switching to the shop identity check between these clicks dismisses the popover.
    await locator.click();
    const tooltip = frame.getByRole('tooltip').filter({hasText:'扫码查看商品'});
    copyButton = tooltip.getByRole('button',{name:'复制链接',exact:true});
    await copyButton.waitFor({state:'visible',timeout:3000});
  }
  const capture = await frame.evaluateHandle(() => {
    let resolve;
    const value = new Promise(done => { resolve = done; });
    const clipboard = navigator.clipboard;
    const descriptor = clipboard && Object.getOwnPropertyDescriptor(clipboard,'writeText');
    let installed = false;
    if (clipboard) {
      try {
        Object.defineProperty(clipboard,'writeText',{configurable:true,value:async text => { resolve(String(text)); }});
        installed = true;
      } catch {}
    }
    const onCopy = event => {
      const el = document.activeElement;
      const selection = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value.slice(el.selectionStart ?? 0,el.selectionEnd ?? 0) : '';
      const text = event.clipboardData?.getData('text/plain') || selection || String(window.getSelection() || '');
      if (text) resolve(text);
    };
    window.addEventListener('copy',onCopy);
    return {value, restore() {
      window.removeEventListener('copy',onCopy);
      if (installed && descriptor) Object.defineProperty(clipboard,'writeText',descriptor);
      else if (installed) delete clipboard.writeText;
    }};
  });
  try {
    await copyButton.click();
    const text = await capture.evaluate(c => Promise.race([c.value,new Promise(done=>setTimeout(()=>done(''),2000))]));
    let url;
    try { url = new URL(text); } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password ||
        !/(^|\.)(jd\.com|3\.cn)$/i.test(url.hostname)) throw Error('复制按钮未返回可核实的京东商品链接');
    return url.href;
  } finally {
    await capture.evaluate(c=>c.restore()).catch(()=>{});
    await capture.dispose();
  }
}

export async function closeJdNotice(page) {
  if (!['jdsz.jd.com','sz.jd.com'].includes(new URL(page.url()).hostname)) return;
  for (const frame of page.frames()) {
    if (!/^https:\/\/(jdsz|sz)\.jd\.com\//.test(frame.url())) continue;
    const close = frame.locator('.win-notice-modal .close-modal:visible').first();
    if (await close.isVisible()) {
      await close.click({timeout:2500});
      await close.waitFor({state:'hidden',timeout:2500});
    }
  }
}

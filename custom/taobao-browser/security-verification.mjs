import {finishVerification,needsLogin,officialTaskPage,presentVerification,setTaskWindowState,taskWindow} from './task-window.mjs';

export function securityVerification(message = '商家后台要求完成安全验证') {
  return Object.assign(new Error(message), {authStatus:'security_verification'});
}

async function detectSecurityPrompt(page) {
  const taobao = /^(?:https:\/\/)(?:[\w-]+\.)*taobao\.com\//i.test(page.url?.() ?? '');
  for (const frame of page.frames?.() ?? []) {
    if (!frame.getByText) continue;
    if (taobao && await frame.getByText(/触发安全机制.{0,40}限制访问|依据平台规则限制访问/).filter({visible:true}).first().isVisible()) {
      throw Object.assign(securityVerification('淘宝已限制访问，请在官方页面查看处理指引。'),{accessRestricted:true});
    }
    const prompt = frame.getByText(/请完成安全验证|请向右滑块完成拼图|请拖动滑块完成验证|请先完成安全验证/);
    const mask = frame.locator('.baxia-dialog-mask');
    if (await prompt.or(mask).filter({visible:true}).first().isVisible().catch(()=>false))
      throw securityVerification();
  }
}

export async function checkSecurityPrompt(page,assertAccess=()=>{}) {
  const task=taskWindow(page);
  if(!officialTaskPage(page,task))return detectSecurityPrompt(page);
  let shown=false;
  const deadline=Date.now()+300000;
  try{
    for(;;){
      assertAccess();
      if(page.isClosed())throw shown ? securityVerification('验证窗口已关闭，尚未确认验证完成') : Error('商家已关闭验证窗口');
      const login=needsLogin(page,task) || (task.platform==='wechat-shop' &&
        await page.getByText(/^(扫码进入我的小店|登录超时，请重新登录)$/).filter({visible:true}).first().isVisible());
      let challenge;
      try{await detectSecurityPrompt(page);}catch(e){if(e.authStatus!=='security_verification'||e.accessRestricted)throw e;challenge=e;}
      if(login && !challenge && task.platform==='taobao')throw Object.assign(Error('千牛要求重新登录，请从店铺管理打开该店的手动登录窗口'),{expired:true});
      if(!login&&!challenge)return shown;
      if(Date.now()>=deadline)throw challenge??Object.assign(Error('等待商家完成登录超时'),{expired:true});
      if(!shown){shown=true;console.info('店铺任务等待人工处理',task.platform,login?'登录':'安全验证');await presentVerification(page,task);}
      await page.waitForTimeout(500).catch(error=>{
        if(page.isClosed())throw securityVerification('验证窗口已关闭，尚未确认验证完成');
        throw error;
      });
    }
  }finally{
    if(shown)await finishVerification(page,task);
  }
}

// Interactive identity checks keep the original merchant page alive while the user verifies.
export function loginPromptHandler(platform,notify) {
  return async function inspect(page,{confirm=false}={}) {
    if(!officialTaskPage(page,{platform}))return false;
    if(confirm)await page.waitForTimeout(500);
    let shown=false;
    const task=taskWindow(page), deadline=Date.now()+300000;
    try {
      for(;;){
        if(page.isClosed())throw securityVerification('验证页面已关闭，请重新检查登录');
        try{await detectSecurityPrompt(page);return shown;}
        catch(error){
          if(error.authStatus!=='security_verification'||error.accessRestricted)throw error;
        }
        if(Date.now()>=deadline)throw securityVerification('等待手动验证超时，请重新检查登录');
        if(!shown){
          if(task)await presentVerification(page,task);
          else await setTaskWindowState(page,'normal');
          shown=true;
          await notify(page);
        }
        await page.waitForTimeout(350).catch(()=>{throw securityVerification('验证页面已关闭，请重新检查登录');});
      }
    } finally {
      if(shown&&task)await finishVerification(page,task).catch(()=>{});
    }
  };
}

// Give the merchant time to complete the platform's prompt in the current visible window.
export async function waitForMerchantVerification(page,assertAccess,deadline) {
  let shown=false;
  for(;;) {
    assertAccess();
    try {await checkSecurityPrompt(page);return shown;}
    catch(e) {
      if(e.authStatus!=='security_verification'||e.accessRestricted||Date.now()>=deadline)throw e;
      if(!shown){await page.bringToFront();shown=true;}
      await page.waitForTimeout(500);
    }
  }
}


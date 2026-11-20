import {isPlatformLogin,validatePlatformUrl} from './platforms.mjs';

const tasks=new WeakMap();

export function registerTaskWindow(context,platform) {
  const task={platform,prompts:new Set(),pending:Promise.resolve()};
  task.onPage=page=>{
    task.pending=task.pending.then(async()=>{
      if(tasks.get(context)===task&&!task.prompts.size&&!page.isClosed())
        await setTaskWindowState(page,'minimized');
    }).catch(()=>{});
  };
  tasks.set(context,task);
  context.on('page',task.onPage);
}
export function taskWindow(page) {return tasks.get(page?.context?.());}
export async function releaseTaskWindow(context) {
  const task=tasks.get(context);
  if(!task)return;
  tasks.delete(context);
  context.off('page',task.onPage);
  await task.pending;
}

export async function presentVerification(page,task) {
  task.prompts.add(page);
  await task.pending;
  if(taskWindow(page)===task)await setTaskWindowState(page,'normal');
}

export async function finishVerification(page,task) {
  task.prompts.delete(page);
  if(taskWindow(page)!==task||task.prompts.size)return;
  const remaining=page.isClosed()?page.context().pages()[0]:page;
  if(remaining)await setTaskWindowState(remaining,'minimized');
}

export async function setTaskWindowState(page,state) {
  const cdp=await page.context().newCDPSession(page);
  try {
    const {windowId,bounds}=await cdp.send('Browser.getWindowForTarget');
    if(bounds.windowState!==state)
      await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:state}});
    if(state==='normal')await page.bringToFront();
  } finally {await cdp.detach().catch(()=>{});}
}

export function needsLogin(page,task) {
  return task && isPlatformLogin(page.url(),task.platform);
}

export function officialTaskPage(page,task) {
  if(!task)return false;
  try{validatePlatformUrl(page.url(),task.platform);return true;}catch{return false;}
}

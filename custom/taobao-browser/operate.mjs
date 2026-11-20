import {request} from './client.mjs';
const [account,action='inspect']=process.argv.slice(2);
console.log(JSON.stringify(await request(account?{account,action}:undefined),null,2));

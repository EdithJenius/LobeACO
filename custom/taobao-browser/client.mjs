import fs from 'node:fs/promises';
export async function request(command) {
  const {port,token}=JSON.parse(await fs.readFile(new URL('./runtime/connection.json',import.meta.url),'utf8'));
  const res=await fetch(`http://127.0.0.1:${port}${command?'/command':'/status'}`,{method:command?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(command?{body:JSON.stringify(command)}:{})});
  const data=await res.json(); if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data;
}

import { createECDH, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const directory=path.join(root,".local","notification-setup");
if(process.argv.includes("--prepare-setup")&&fs.existsSync(directory)){
 process.stdout.write("Private setup files already exist; existing keys were preserved.\n");
}else{
 const ec=createECDH("prime256v1");ec.generateKeys();
 const pair={publicKey:ec.getPublicKey().toString("base64url"),privateKey:ec.getPrivateKey().toString("base64url")};
 if(process.argv.includes("--prepare-setup")){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const bridge=randomBytes(32).toString("hex"),ingestion=randomBytes(32).toString("hex");
  const files={
   "vercel-settings.env":`# Private: copy each NAME=value into Vercel Environment Variables. Do not share.\nNEXT_PUBLIC_VAPID_PUBLIC_KEY=${pair.publicKey}\nVAPID_PRIVATE_KEY=${pair.privateKey}\nVAPID_SUBJECT=mailto:indymoundhounds@gmail.com\nRESULTS_BRIDGE_SECRET=${bridge}\nPICK_PUSH_ENABLED=false\nADMIN_RESULTS_PUSH_ENABLED=true\n`,
   "github-secrets.env":`# Private: GitHub repository -> Settings -> Secrets and variables -> Actions -> Secrets.\nRESULTS_BRIDGE_SECRET=${bridge}\nRACE_RESULTS_WEBHOOK_SECRET=${ingestion}\n`,
   "github-variables.env":`# GitHub Actions Variables. Leave disabled until the reviewed public release is ready.\nRESULTS_BRIDGE_URL=https://moundhoundspickem.app/api/internal/results-automation\nRESULTS_MONITOR_ENABLED=false\n`
  };
  for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(directory,name),content,{mode:0o600,flag:"wx"});
  process.stdout.write("Prepared private setup files under .local/notification-setup/. No values displayed; no live settings changed.\n");
 }else process.stdout.write(JSON.stringify(pair)+"\n");
}

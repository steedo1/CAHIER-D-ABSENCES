import { chromium } from "playwright";
import { mkdir,writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin=process.env.CARD_QA_ORIGIN || "http://localhost:4397";
const browser=await chromium.launch({executablePath:process.env.CARD_CHROME || undefined,headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on("pageerror",e=>errors.push(e.message));
await mkdir("tmp/school-cards",{recursive:true});
const metrics=[];
try {
  await page.goto(origin,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:/Sélectionner les résultats \(12\)/}).waitFor();
  await page.getByRole("button",{name:/Sélectionner les résultats/}).click();
  await page.getByRole("button",{name:"Aperçu recto verso",exact:true}).click();
  await page.getByAltText("QR obligatoire de vérification").waitFor();
  await page.screenshot({path:"tmp/school-cards/workspace-desktop.png",fullPage:true});
  await page.getByRole("checkbox",{name:/J’accepte d’imprimer/}).check();
  await page.getByRole("button",{name:"Générer les PDF A4 / Imprimer",exact:true}).click();
  await page.getByRole("link",{name:/Cartes-2026-2027-1-12.pdf/}).waitFor({timeout:60000});
  const countBefore=(await(await page.request.get(`${origin}/qa/metrics`)).json()).calls.length;
  await page.getByRole("button",{name:"Générer les PDF A4 / Imprimer",exact:true}).click();
  await page.getByRole("link",{name:/Cartes-2026-2027-1-12.pdf/}).waitFor({timeout:60000});
  const countAfter=(await(await page.request.get(`${origin}/qa/metrics`)).json()).calls.length;
  assert.equal(countAfter,countBefore,"browser reprint must issue no new SQL transport reads");
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"tmp/school-cards/workspace-mobile.png",fullPage:true});
  for(const count of [500,1000]) {
    await page.setViewportSize({width:1440,height:1000});
    await page.getByLabel("Scénario de recette").selectOption(String(count));
    await page.getByRole("button",{name:`Tout l’établissement (${count})`,exact:true}).waitFor({timeout:60000});
    await page.getByRole("button",{name:`Tout l’établissement (${count})`,exact:true}).click();
    const acceptMissing=page.getByRole("checkbox",{name:/J’accepte d’imprimer/});
    if(await acceptMissing.count()) await acceptMissing.check();
    const cdp=await page.context().newCDPSession(page);
    const before=await cdp.send("Runtime.getHeapUsage"),start=Date.now();
    await page.getByRole("button",{name:"Générer les PDF A4 / Imprimer",exact:true}).click();
    await page.getByText(`${count} carte(s) préparée(s).`,{exact:false}).waitFor({timeout:120000});
    const after=await cdp.send("Runtime.getHeapUsage");
    const data=await(await page.request.get(`${origin}/qa/metrics`)).json();
    const links=page.getByRole("link",{name:/Ouvrir pour imprimer/});assert.equal(await links.count(),count/100);
    const downloads=await page.locator('a[download]').evaluateAll(async elements=>Promise.all(elements.map(async el=>{const b=await(await fetch(el.href)).blob();return{name:el.download,size:b.size}})));
    metrics.push({count,elapsedMs:Date.now()-start,heapBeforeMiB:+(before.usedSize/1048576).toFixed(1),heapAfterMiB:+(after.usedSize/1048576).toFixed(1),serverRssMiB:+(data.rss/1048576).toFixed(1),groupedTransportCalls:data.calls.filter(c=>c.op==="read").length,storageSigningBatches:data.calls.filter(c=>c.op==="sign-batch").length,sqlWrites:data.calls.filter(c=>!["read","sign-batch"].includes(c.op)).length,pdfs:downloads.length,pdfBytes:downloads.reduce((sum,x)=>sum+x.size,0),scope:"headless Chrome desktop; synthetic transport and 240x320 JPEG textures; not real pupil photos or live Supabase latency"});
    await cdp.detach();
  }
  assert.deepEqual(errors,[]);
  await writeFile("tmp/school-cards/browser-metrics.json",JSON.stringify(metrics,null,2));
  console.log(JSON.stringify({errors,metrics},null,2));
} finally {await browser.close()}

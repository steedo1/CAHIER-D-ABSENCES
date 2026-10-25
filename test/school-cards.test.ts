import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { issueCardToken, openCardToken, createCardScanLimiter } from "../src/lib/school-card-token";
import { cardSheetPosition, signatureSlotForTracks } from "../src/lib/school-cards";
import { processSchoolCardSignature } from "../src/lib/school-card-image";

const key = "isolated-test-secret-not-a-real-key-2026";
const identity = () => ({ institutionId:randomUUID(),studentId:randomUUID(),enrollmentId:randomUUID(),classId:randomUUID(),year:"2026-2027" });
test("opaque authenticated tokens are stable across reprints, isolated by year/class/enrollment and reject forgery", () => {
  const p = identity(), token = issueCardToken(p,key);
  assert.equal(token.length,136); assert.equal(issueCardToken(p,key),token);
  assert.deepEqual(openCardToken(token,key),p);
  assert.equal(openCardToken(token,"other-secret-not-a-real-key-2026----"),null);
  assert.equal(openCardToken(token.slice(0,-1)+(token.at(-1)==="A"?"B":"A"),key),null);
  assert.equal(openCardToken("x".repeat(100000),key),null);
  for (const next of [{...p,year:"2027-2028"},{...p,classId:randomUUID()},{...p,enrollmentId:randomUUID()}]) assert.notEqual(issueCardToken(next,key),token);
  assert.equal(Buffer.from(token,"base64url").includes(Buffer.from(p.studentId)),false);
  assert.throws(()=>issueCardToken(p,""));
});
test("1000 tokens are distinct with no persistence or per-card reads", () => {
  const tokens = new Set(Array.from({length:1000},()=>issueCardToken(identity(),key)));
  assert.equal(tokens.size,1000);
});
test("A4 long/short edge mirror exact card rectangles, including last partial sheet", () => {
  for(let i=0;i<10;i++) {
    const a=cardSheetPosition(i,"front"), b=cardSheetPosition(i,"back"), c=cardSheetPosition(i,"back","short");
    assert.ok(Math.abs(a.x+b.x+85.6-210)<1e-9);
    assert.ok(Math.abs(a.y+c.y+54-297)<1e-9);
    assert.equal(a.y,b.y); assert.equal(a.x,c.x);
    assert.ok(a.x>=0 && a.y>=0 && a.x+85.6<=210 && a.y+54<=297);
  }
});
test("French/Arabic director selected only from an unambiguous configured program", () => {
  assert.equal(signatureSlotForTracks(["arabic"],true),"arabic");
  assert.equal(signatureSlotForTracks(["french"],true),"french");
  assert.equal(signatureSlotForTracks(["french","arabic"],true),null);
  assert.equal(signatureSlotForTracks([],true),null);
  assert.equal(signatureSlotForTracks([],false),"general");
});
test("scan limiter bounds per-token, per-IP and total traffic then recovers", () => {
  let time=0; const allow=createCardScanLimiter(()=>time);
  for(let i=0;i<8;i++) assert.equal(allow("a","token"),true);
  assert.equal(allow("b","token"),false);
  time=60001; assert.equal(allow("a","token"),true);
  for(let i=0;i<12;i++) allow("c",`other${i}`);
  assert.equal(allow("c","new"),false);
});
test("background removal preserves colored ink and enclosed white seal details; no removal option preserves original appearance", async () => {
  const width=30,height=30,pixels=Buffer.alloc(width*height*4,255);
  for(let y=8;y<=21;y++) for(let x=8;x<=21;x++) if(y===8||y===21||x===8||x===21) {
    const p=(y*width+x)*4; pixels[p]=20;pixels[p+1]=40;pixels[p+2]=180;
  }
  const original=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  const output=await processSchoolCardSignature(original,{removeBackground:true,tolerance:24,crop:false});
  const raw=await sharp(output).raw().toBuffer();
  assert.equal(raw[3],0); assert.equal(raw[(10*width+10)*4+3],255);
  assert.deepEqual([...raw.subarray((8*width+8)*4,(8*width+8)*4+4)],[20,40,180,255]);
  const unmodified=await processSchoolCardSignature(original,{removeBackground:false,tolerance:24,crop:false});
  assert.deepEqual(await sharp(unmodified).raw().toBuffer(),pixels);
  assert.equal((await sharp(original).metadata()).width,30);
});

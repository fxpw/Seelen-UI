import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd(), dir = path.resolve(".tools/popup-toggle-tests");
await fs.mkdir(dir, { recursive: true });
const mock = `
export const WidgetPreset={Popup:'Popup',Overlay:'Overlay',Desktop:'Desktop',None:'None'},WidgetStatus={Ready:'Ready'};
export const SeelenEvent={GlobalFocusChanged:'focus'},SeelenCommand=new Proxy({},{get:(_,p)=>p});
export async function invoke(){return null;}export async function subscribe(event,cb){globalThis.__focusListener=cb;}
export const decodeBase64Url=s=>new TextEncoder().encode(atob(s));
export const getCurrentWebview=()=>({label:btoa('@seelen/calendar-popup')});
export const initMonitorsState=async()=>{},startThemingTool=async()=>{},disableAnimationsOnPerformanceMode=async()=>{};
export const fitIntoMonitor=v=>v,adjustPositionByPlacement=v=>v;
export class Widget_3 {
 window=globalThis.__fixture.window;autoSize={enabled:false};
 onTrigger(cb){this.trigger=cb;return()=>{};}
 async adjustAndSetPosition(...args){globalThis.__fixture.placements.push(args);await globalThis.__fixture.prepare?.();}
 async executeAutoSize(){}get windowId(){return 123;}
}
export const OPTIMISTIC_FRAME={runExclusive:async fn=>fn({init(){}})};
`;
const entry = `
import assert from 'node:assert/strict';import {Widget} from './libs/core/src/state/widget/mod.ts';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const payload=(source='panel:A',toggle=true)=>({desiredPosition:{x:100,y:200},customArgs:toggle?{toggle:true,toggleSource:source}:null});
function setup(){
 const f=globalThis.__fixture={shown:false,showCalls:0,hideCalls:0,placements:[],animations:[],prepare:null};
 f.window={async show(){f.shown=true;f.showCalls++;},async hide(){f.shown=false;f.hideCalls++;},async close(){},async isVisible(){return f.shown;}};
 globalThis.document={documentElement:{dataset:{widgetHidden:''}},getAnimations:()=>f.animations};
 globalThis.__SLU_WIDGET={lazy:true,preset:'Popup',settings:[]};delete globalThis.__SLU_WIDGET_INSTANCE;
 const w=Widget.self;w.adjustAndSetPosition=async(...args)=>{f.placements.push(args);await f.prepare?.();};w.applyPopupPreset();return {f,w};
}
let count=0;async function check(name,run){await run();count++;console.log('PASS '+name);}
await check('same button opens, closes and reopens in one click each',async()=>{const{f,w}=setup();await w.trigger(payload());assert.equal(f.shown,true);await w.trigger(payload());assert.equal(f.shown,false);await w.trigger(payload());assert.equal(f.shown,true);});
await check('second click cancels unfinished placement without flashing the native window',async()=>{const{f,w}=setup(),position=deferred();f.prepare=()=>position.promise;const first=w.trigger(payload());assert.equal(w.isShown,true);await w.trigger(payload());position.resolve();await first;assert.equal(f.showCalls,0);assert.equal(w.isShown,false);assert.equal(f.shown,false);});
await check('click during close reverses it and an older hide cannot close the reopened menu',async()=>{const{f,w}=setup();await w.trigger(payload());const animation=deferred();f.animations=[{effect:{getComputedTiming:()=>({iterations:1})},finished:animation.promise}];const closing=w.trigger(payload());assert.equal(w.isShown,false);await w.trigger(payload());animation.resolve();await closing;assert.equal(w.isShown,true);assert.equal(f.shown,true);assert.equal(f.hideCalls,0);});
await check('another monitor or button moves the popup instead of toggling it shut',async()=>{const{f,w}=setup();await w.trigger(payload('left:A'));await w.trigger(payload('right:A'));assert.equal(f.shown,true);assert.equal(f.placements.length,2);await w.trigger(payload('right:A'));assert.equal(f.shown,false);});
await check('ordinary CLI, hover and context triggers preserve show semantics',async()=>{const{f,w}=setup();await w.trigger(payload(null,false));await w.trigger(payload(null,false));assert.equal(f.showCalls,2);assert.equal(f.shown,true);});
await check('outside dismissal resets intent so the next button click opens',async()=>{const{f,w}=setup();await w.trigger(payload());await w.hide();await w.trigger(payload());assert.equal(f.shown,true);});
await check('a queued focus-loss hide cannot close a newly requested popup',async()=>{const{f,w}=setup();w.hideOnFocusLoss();await w.trigger(payload());globalThis.__focusListener({payload:{hwnd:123}});globalThis.__focusListener({payload:{hwnd:999}});await w.trigger(payload('another'));await wait(140);assert.equal(f.shown,true);});
await check('failed placement rolls visibility intent back',async()=>{const{w}=setup();await assert.rejects(w.show(async()=>{throw Error('placement failure');}));assert.equal(w.isShown,false);assert.equal(document.documentElement.dataset.widgetHidden,'');});
console.log('PASS '+count+' actual widget visibility/trigger regression scenarios.');
`;
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(dir, "test.mjs"),
  plugins: [{
    name: "mock-native-only",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer.endsWith("/state/widget/mod.ts") || args.importer.endsWith("\\state\\widget\\mod.ts")) {
          if (args.path === "./abstractions/mod.ts") {
            return { path: path.resolve("libs/core/src/state/widget/abstractions/4_visibility.ts") };
          }
          if (args.path === "../../utils/async.ts") return { path: path.resolve("libs/core/src/utils/async.ts") };
          return { path: "mock", namespace: "fixture" };
        }
        if (args.path === "./3_autosize.ts") return { path: "mock", namespace: "fixture" };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: mock, loader: "ts" }));
      build.onLoad(
        { filter: /4_visibility\.ts$/ },
        async (args) => ({
          contents: (await fs.readFile(args.path, "utf8")) + "\nexport {Widget_4 as WidgetBasics};",
          loader: "ts",
          resolveDir: path.dirname(args.path),
        }),
      );
    },
  }],
});
await import(pathToFileURL(path.join(dir, "test.mjs")).href);

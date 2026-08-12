import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"./e2e",fullyParallel:true,retries:process.env.CI?2:0,reporter:"list",
  use:{baseURL:"http://localhost:3000",trace:"on-first-retry",screenshot:"only-on-failure"},
  webServer:{command:"npm run dev -- --hostname 127.0.0.1",url:"http://localhost:3000",reuseExistingServer:false,timeout:120_000,env:{NEXT_PUBLIC_PIKAS_DEMO_MODE:"true"}},
  projects:[
    {name:"mobile-390",use:{browserName:"chromium",viewport:{width:390,height:844}}},
    {name:"tablet-768",use:{browserName:"chromium",viewport:{width:768,height:1024}}},
    {name:"desktop-1440",use:{browserName:"chromium",viewport:{width:1440,height:900}}},
  ],
});

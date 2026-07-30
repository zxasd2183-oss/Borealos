// imagegen 重建实测脚本（一次性）
const fs = require("fs");
const path = require("path");
const m = require("D:/KIMI/work-ui/imagegen.js");

(async () => {
  // 1) 文本
  console.log("[1] generateText ...");
  const t0 = Date.now();
  const text = await m.generateText("只回复两个字：通了");
  console.log("[1] OK", (Date.now() - t0) + "ms", JSON.stringify(text));

  // 2) 画图
  console.log("[2] generateImage ...");
  const r = await m.generateImage({
    prompt: "一只橘猫坐在窗台上，照片写实风格",
    size: "1024x1024",
    quality: "low",
  });
  const buf = Buffer.from(r.b64, "base64");
  const dim = m._test.pngSize(buf);
  const out = "D:/KIMI/shots/imagegen-rebuild-test.png";
  fs.writeFileSync(out, buf);
  console.log("[2] OK elapsedMs=" + r.elapsedMs, "bytes=" + buf.length, "dim=" + JSON.stringify(dim), "saved=" + out);
})().catch((e) => {
  console.error("FAIL:", e.code || "", e.message);
  process.exit(1);
});

const { spawnSync } = require("child_process");

const bucket = "webreplay-website";

function upload(src, dst) {
  if (!dst) {
    dst = src;
  }
  spawnSync("aws", ["s3", "cp", src, `s3://${bucket}/${dst}`], { stdio: "inherit" });
}

upload("index.html", "typesView");
upload("dist/typesMain.js");

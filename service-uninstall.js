const Service = require("node-windows").Service;
const path = require("path");

const svc = new Service({
  name: "LMS Portal",
  script: path.join(__dirname, "app.js"),
});

svc.on("uninstall", function () {
  console.log("Service completely uninstalled.");
});

svc.uninstall();

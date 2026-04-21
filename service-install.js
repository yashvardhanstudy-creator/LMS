const Service = require("node-windows").Service;
const path = require("path");

// Create a new Windows service object
const svc = new Service({
  name: "LMS Portal",
  description: "Local Network Node.js LMS Web Server.",
  script: path.join(__dirname, "app.js"),
  env: [
    {
      name: "NODE_ENV",
      value: "production",
    },
  ],
});

svc.on("install", function () {
  svc.start();
  console.log("Service installed and started successfully.");
});

svc.install();

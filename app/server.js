var express = require("express");
var OBDReader = require("../lib/obd.js");
var app = express();
var http = require("http").Server(app);
var io = require("socket.io")(http);
var debug = require("debug")("obd");

var options = {};
options.baudRate = 9600;
var serialOBDReader = new OBDReader("COM6", options);

// Server
http.listen(8080, function () {
  debug("Listening on *:8080");

  serialOBDReader.on("rpm", function (data) {
    io.emit("rpm", data);
  });

  serialOBDReader.on("vss", function (data) {
    io.emit("vss", data);
  });

  serialOBDReader.on("throttlepos", function (data) {
    io.emit("throttlepos", data);
  });

  serialOBDReader.on("temp", function (data) {
    io.emit("temp", data);
  });

  serialOBDReader.on("maf", function (data) {
    io.emit("maf", data);
  });

  serialOBDReader.on("requestdtc", function (data) {
    io.emit("requestdtc", data);
  });

  serialOBDReader.on("debug", function (data) {
    console.log(data);
  });

  serialOBDReader.on("connected", function (data) {
    this.addPoller("rpm");
    this.addPoller("vss");
    this.addPoller("throttlepos");
    this.addPoller("temp");
    this.addPoller("maf");

    this.startPolling(10);
  });

  serialOBDReader.connect();
});

io.on("connection", function (socket) {
  debug("User connected");

  socket.on("requestdtc", function () {
    serialOBDReader.requestValueByName("requestdtc", 0, true);
  });

  socket.on("cleardtc", function () {
    serialOBDReader.requestValueByName("cleardtc", 0, true);
  });

  socket.on("disconnect", function () {
    debug("User disconnected");
  });
});

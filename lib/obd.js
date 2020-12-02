'use strict';
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var PIDS = require('../lib/obdInfo.js');

var DTCS = require('../lib/obddtc.js');

var writeDelay = 50;

var queue = [];

var lastSentCommand = '';

var OBDReader;

OBDReader = function(portName, options) {

    EventEmitter.call(this);
    this.connected = false;
    this.receivedData = "";
    this.awaitingReply = false;
    this.SERIAL_PORT = portName;
    this.OPTIONS = options;

    return this;
};
util.inherits(OBDReader, EventEmitter);

function getPIDByName(name) {
    var i;
    for (i = 0; i < PIDS.length; i++) {
        if (PIDS[i].name === name) {
            if (PIDS[i].pid !== undefined) {
                return (PIDS[i].mode + PIDS[i].pid);
            }
            return (PIDS[i].mode);
        }
    }
}

function parseOBDCommand(hexString) {

    var reply,
        byteNumber,
        valueArray;

    reply = {};
    if (hexString === "NO DATA" || hexString === "OK" || hexString === "?" || hexString === "UNABLE TO CONNECT" || hexString === "SEARCHING...") {
        reply.value = hexString;
        return reply;
    }

    hexString = hexString.replace(/ /g, '');
    valueArray = [];

    for (byteNumber = 0; byteNumber < hexString.length; byteNumber += 2) {
        valueArray.push(hexString.substr(byteNumber, 2));
    }

    if (valueArray[0] === "41") {
        reply.mode = valueArray[0];
        reply.pid = valueArray[1];
        for (var i = 0; i < PIDS.length; i++) {
            if (PIDS[i].pid == reply.pid) {
                var numberOfBytes = PIDS[i].bytes;
                reply.name = PIDS[i].name;
                switch (numberOfBytes) {
                    case 1:
                        reply.value = PIDS[i].convertToUseful(valueArray[2]);
                        break;
                    case 2:
                        reply.value = PIDS[i].convertToUseful(valueArray[2], valueArray[3]);
                        break;
                    case 4:
                        reply.value = PIDS[i].convertToUseful(valueArray[2], valueArray[3], valueArray[4], valueArray[5]);
                        break;
                    case 8:
                        reply.value = PIDS[i].convertToUseful(valueArray[2], valueArray[3], valueArray[4], valueArray[5], valueArray[6], valueArray[7], valueArray[8], valueArray[9]);
                        break;
                }
                break;
            }
        }
    } else if (valueArray[0] === "43") {
        reply.mode = valueArray[0];
        for (var i = 0; i < PIDS.length; i++) {
            if (PIDS[i].mode == "03") {
                reply.name = PIDS[i].name;
                reply.value = PIDS[i].convertToUseful(valueArray[1], valueArray[2], valueArray[3], valueArray[4], valueArray[5], valueArray[6]);
            }
        }
    }
    return reply;
}

OBDReader.prototype.connect = function() {
    var self = this;

    var SerialPort = require('serialport');

    this.serial = new SerialPort(this.SERIAL_PORT, this.OPTIONS);

    this.serial.on('close', function(err) {
        console.log("Serial port [" + self.SERIAL_PORT + "] was closed");
    });

    this.serial.on('error', function(err) {
        console.log("Serial port [" + self.SERIAL_PORT + "] is not ready");
    });

    this.serial.on('open', function() {
        self.connected = true;

        self.write('ATE0');
        self.write('ATL0');
        self.write('ATS0');
        self.write('ATH0');
        self.write('ATAT2');
        self.write('ATST0A');
        self.write('ATSP0');

        self.emit('connected');
    });

    this.serial.on('data', function(data) {

        var currentString, arrayOfCommands;
        currentString = self.receivedData + data.toString('utf8');

        arrayOfCommands = currentString.split('>');

        var forString;
        if (arrayOfCommands.length < 2) {
            self.receivedData = arrayOfCommands[0];
        } else {
            for (var commandNumber = 0; commandNumber < arrayOfCommands.length; commandNumber++) {
                forString = arrayOfCommands[commandNumber];
                if (forString === '') {
                    continue;
                }

                var multipleMessages = forString.split('\r');
                for (var messageNumber = 0; messageNumber < multipleMessages.length; messageNumber++) {
                    var messageString = multipleMessages[messageNumber];
                    if (messageString === '') {
                        continue;
                    }
                    self.emit('debug', 'in    ' + messageString);

                    var reply;
                    reply = parseOBDCommand(messageString);

                    if (reply.mode == '41' && reply.pid != undefined) {
                        self.emit(reply.name, reply);
                    } else if (reply.name == "requestdtc") {
                        if (reply.value != undefined) {
                            let errors = [];
                            let errorCodes = reply.value.errors;
                            errorCodes.forEach(code => {
                                if (code in DTCS) {
                                    errors.push({
                                        code: code,
                                        description: DTCS[code]
                                    });
                                }
                            });
                            reply.value.errors = errors;
                            if (reply.value.errors.length > 0) {
                                self.emit("requestdtc", reply);
                            }
                        }
                    }

                    if (self.awaitingReply == true) {
                        self.awaitingReply = false;
                        self.emit('processQueue');
                    }
                    self.receivedData = '';
                }
            }
        }
    });

    this.on('processQueue', function() {
        if (self.awaitingReply == true) {
            self.emit('debug', 'processQueue: awaitingReply true')
        } else {
            if (queue.length > 0 && self.connected) {
                try {
                    self.awaitingReply = true;
                    self.emit('debug', 'out   ' + queue[0]);
                    lastSentCommand = queue[0];
                    self.serial.write(queue.shift() + '\r');
                } catch (err) {
                    console.log('Error while writing: ' + err);
                    console.log('OBD-II Listeners deactivated, connection is probably lost.');
                    self.removeAllPollers();
                }
            }
        }
    });
    return this;
};

OBDReader.prototype.disconnect = function() {
    clearInterval(this.intervalWriter);
    queue.length = 0; 
    this.serial.close();
    this.connected = false;
};

OBDReader.prototype.write = function(message, replies = 0, priority = false) {
    if (this.connected) {
        if (queue.length != null) {
            this.emit('debug', 'queue ' + message + replies)
            
            if (priority) {
                if (replies !== 0) {
                    queue.unshift(message + replies);
                } else {
                    queue.unshift(message);
                }
            } 
            else {
                if (replies !== 0) {
                    queue.push(message + replies);
                } else {
                    queue.push(message);
                }
            }

            if (this.awaitingReply == false) {
                this.emit('processQueue');
            }

        } else {
            console.log('Queue-overflow!');
        }
    } else {
        console.log('OBD Serial device is not connected.');
    }
};

OBDReader.prototype.requestValueByName = function(name, replies = 0, priority = false) {
    this.write(getPIDByName(name), replies, priority);
};

var activePollers = [];

OBDReader.prototype.addPoller = function(name) {
    var stringToSend = getPIDByName(name);
    activePollers.push(stringToSend);
};

OBDReader.prototype.removePoller = function(name) {
    var stringToDelete = getPIDByName(name);
    var index = activePollers.indexOf(stringToDelete);
    activePollers.splice(index, 1);
};

OBDReader.prototype.removeAllPollers = function() {
    activePollers.length = 0; 
};

OBDReader.prototype.writePollers = function() {
    if(queue.length < 100){
        activePollers.forEach(element => {
            this.write(element, 1);
        });
    }
};

var pollerInterval;

OBDReader.prototype.startPolling = function(interval) {
    if (interval === undefined) {
        interval = activePollers.length * (writeDelay * 2);
    }

    var self = this;
    pollerInterval = setInterval(function() {
        self.writePollers();
    }, interval);
};

OBDReader.prototype.stopPolling = function() {
    clearInterval(pollerInterval);
};

var exports = module.exports = OBDReader;
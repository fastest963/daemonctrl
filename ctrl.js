var events = require('events'),
    util = require('util'),
    net = require('net'),
    _ctrl;
global._daemonctrl = _ctrl = (global._daemonctrl || {});
if (!_ctrl.socketOptions) {
    _ctrl.socketOptions = {path: './control.sock'};
}

function getCommand(strip) {
    if (_ctrl.command !== undefined) {
        return _ctrl.command;
    }
    var i = 1, //skip over filename
        command = '';

    //process.execPath is /usr/bin/node
    //see http://nodejs.org/api/process.html#process_process_execargv
    if (process.argv[0] === process.execPath || process.argv[1] === process.mainModule.filename) {
        //the next arg is the filename
        i = 2;
    }
    for (; i < process.argv.length && command === ''; i++) {
        switch (process.argv[i][0]) {
            case '{':
            case '-':
                break;
            default:
                //everything else after we got the first part of the command is part of the command
                if (strip) {
                    command = process.argv.splice(i).join(' ');
                } else {
                    command = process.argv.slice(i).join(' ');
                }
                break;
        }
    }
    _ctrl.command = command;
    return command;
}

function SendEmitter() {
    events.EventEmitter.call(this);
}
util.inherits(SendEmitter, events.EventEmitter);
SendEmitter.send = function(cb) {
    var command = getCommand(),
        closed = false,
        options = _ctrl.socketOptions,
        emitter, conn;
    if (!command || command === 'start') {
        return;
    }
    function onEnd() {
        if (closed) {
            return;
        }
        closed = true;
        emitter.emit('end');
    }
    emitter = new SendEmitter();
    conn = new net.Socket();
    conn.on('connect', function() {
        //send our command then FIN
        conn.end(command);
    });
    //allow them to pipe the response
    emitter.pipe = conn.pipe.bind(conn);
    conn.setTimeout(5000, function() {
        conn.destroy();
        emitter.emit('error', new Error('Timeout', 'TIMEOUT'));
    });
    conn.on('error', emitter.emit.bind(emitter, 'error'));
    conn.on('data', emitter.emit.bind(emitter, 'data'));
    conn.on('end', onEnd);
    conn.on('close', onEnd);
    if (typeof cb === 'function') {
        emitter.on('end', cb);
    }
    if (options.port) {
        conn.connect(options.port, options.ip);
    } else {
        conn.connect(options.path);
    }
    return emitter;
}

function ServerEmitter() {
    events.EventEmitter.call(this);
}
util.inherits(ServerEmitter, events.EventEmitter);
ServerEmitter.listen = function(cb) {
    if (_ctrl.server) {
        return _ctrl.server;
    }
    //the calling side sends FIN when its done transmitting so we have to allow half open
    var server = net.createServer({allowHalfOpen: true}),
        emitter = new ServerEmitter(),
        options = _ctrl.socketOptions;
    server.on('connection', function(socket) {
        var command = '';
        socket.setTimeout(5000, function() {
            socket.end();
        });
        socket.setEncoding('utf8');
        socket.on('data', function(data) {
            command += data;
        });
        //once we get a FIN then we know the sending side is done sending data
        socket.on('end', function() {
            if (!command || !socket.writable) {
                socket.end();
                return;
            }
            emitter.emit('command', command, socket);
        });
        socket.on('error', function(err) {
            emitter.emit('clientError', err, socket);
        });
    });
    process.on('exit', function() {
        if (server) {
            server.close();
        }
    })
    //add their callback first before we add any to re-fire on emitter
    if (typeof cb === 'function') {
        emitter.on('listening', cb);
    }
    server.on('listening', function() {
        emitter.emit('listening');
        //don't let this server stop us from dying
        server.unref();
    });
    server.on('error', function(err) {
        emitter.emit('error', err);
    });
    if (options.port) {
        server.listen(options.port, options.ip);
    } else {
        server.listen(options.path);
    }
    _ctrl.server = emitter;
    return emitter;
};

function socketOptions(options) {
    if (options !== undefined) {
        if (!options.path && !options.port) {
            throw new TypeError('socketOptions requires a path or an port');
        }
        if (options.port && !options.ip) {
            options.ip = '0.0.0.0';
        }
        _ctrl.socketOptions = options;
    }
    //todo: we shouldn't be returning a reference
    return _ctrl.socketOptions;
}

exports.strip = getCommand.bind(this, true);
exports.socketOptions = socketOptions;
exports.send = SendEmitter.send;
exports.listen = ServerEmitter.listen;

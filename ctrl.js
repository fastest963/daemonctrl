var events = require('events'),
    util = require('util'),
    net = require('net'),
    child_process = require('child-process-debug'),
    forkArgs,  _ctrl;
global._daemonctrl = _ctrl = (global._daemonctrl || {});
if (!_ctrl.socketOptions) {
    _ctrl.socketOptions = {path: './control.sock'};
}

function spawn() {
    if (!_ctrl._spawnName) {
        throw new Error('Missing moduleName. You must call spawn(moduleName) first');
    }
    var args = getCommand(true).args,
        child;
    child = child_process.spawn(process.execPath, [_ctrl._spawnName].concat(args), {
        //if we redirect the stdout to a pipe then when we die the parent throws a EPIPE
        stdio: _ctrl._detachSpawn ? ['ignore', 'ignore', 'ignore'] : ['pipe', 'pipe', 2],
        detached: _ctrl._detachSpawn
    });
    if (!child.pipe) {
        if (!_ctrl._detachSpawn) {
            child.pipe = child.stdout.pipe.bind(child.stdout);
            child_process.exitWithParent(child);
        } else {
            child.pipe = function() {
                throw new Error('Cannot pipe forked child without possibly breaking child. See README');
            };
        }
    }
    child.unref();
    return child;
}

function getCommand(strip) {
    //if they call strip later still strip
    if (_ctrl.command !== undefined && !strip) {
        return {
            args: forkArgs,
            command: _ctrl.command
        };
    }
    var i = 1, //skip over filename
        args = [],
        command = '';

    //process.execPath is /usr/bin/node
    //see http://nodejs.org/api/process.html#process_process_execargv
    if (process.argv[0] === process.execPath || process.argv[1] === process.mainModule.filename) {
        //the next arg is the filename
        i = 2;
    }
    for (; i < process.argv.length && command === ''; i++) {
        switch (process.argv[i][0]) {
            case '{': //if they sent json
            case '-': //if its a flag
                //don't pass through --fork, -fork, or --fork=yes
                if (process.argv[i] !== '-fork' && process.argv[i] !== '--fork' && process.argv[i].indexOf('-fork=') === -1) {
                    args.push(process.argv[i]);
                }
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
    //if we already ran and got a command, send it back
    //they might've just called this via strip()
    if (_ctrl.command) {
        command = _ctrl.command;
    }
    _ctrl.command = command;
    if (!forkArgs) {
        forkArgs = args;
    }
    return {
        //args here means all the flags sent to the app that we need for forking
        args: args,
        command: command
    };
}

function SendEmitter() {
    events.EventEmitter.call(this);
}
util.inherits(SendEmitter, events.EventEmitter);
SendEmitter.send = function(cb) {
    var command = getCommand().command,
        closed = false,
        options = _ctrl.socketOptions,
        emitter, conn;
    if (!command || command === 'start') {
        if (_ctrl._spawnName !== undefined) {
            emitter = spawn();
            if (typeof cb === 'function') {
                cb(emitter);
            }
        }
        return emitter;
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
    conn.setTimeout(SendEmitter.timeout, function() {
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
};
SendEmitter.timeout = 5000;
SendEmitter.setTimeout = function(newTimeout) {
    if (newTimeout !== undefined) {
        SendEmitter.timeout = newTimeout || 0;
    }
    return SendEmitter.timeout;
};

function ServerEmitter(server) {
    events.EventEmitter.call(this);
    this._server = server;
}
util.inherits(ServerEmitter, events.EventEmitter);
ServerEmitter.listen = function(cb) {
    if (_ctrl.server) {
        return _ctrl.server;
    }
    //the calling side sends FIN when its done transmitting so we have to allow half open
    var server = net.createServer({allowHalfOpen: true}),
        emitter = new ServerEmitter(server),
        options = _ctrl.socketOptions;
    server.on('connection', function(socket) {
        var str = '';
        //the sending end should be able to send us everything we need immediately so this timeout is short
        socket.setTimeout(1000, function() {
            socket.end();
        });
        socket.setEncoding('utf8');
        socket.on('data', function(data) {
            str += data;
        });
        //once we get a FIN then we know the sending side is done sending data
        socket.on('end', function() {
            if (!str || !socket.writable) {
                socket.end();
                return;
            }
            //clear the timeout now that we got all the data
            socket.setTimeout(0);
            var parts = str.split(' ');
            emitter.emit('command', parts[0], parts.slice(1).join(' '), socket);
        });
        socket.on('error', function(err) {
            emitter.emit('clientError', err, socket);
        });
    });
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
ServerEmitter.prototype.end = function() {
    this._server.close();
};
ServerEmitter.prototype.close = function() {
    this._server.close();
};
ServerEmitter.end = function() {
    if (_ctrl.server) {
        _ctrl.server.close();
    }
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

//todo: support detaching
function setSpawn(moduleName, detached) {
    if (moduleName === false) {
        _ctrl._spawnName = undefined;
    } else if (moduleName !== undefined) {
        _ctrl._spawnName = moduleName;
    }
    _ctrl._detachSpawn = !!detached;
}

exports.strip = function() {
    return getCommand(true).command;
};
exports.socketOptions = socketOptions;
exports.fork = setSpawn;
exports.send = SendEmitter.send;
exports.timeout = SendEmitter.setTimeout;
exports.listen = ServerEmitter.listen;
exports.end = ServerEmitter.end;

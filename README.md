# daemonctrl #

Control your daemon via the command line. A `command` is the first word sent after the flags passed to a node script.
The `commandArgs` is anything after the `command` and is not split on spaces.

Example: `node send.js --flags [command] [commandArgs]`

## Docs ##

### socketOptions(options) ###
Allows you to set options for how the socket is setup. This should be sent with the same params from the daemon
and sender.

Options are `path`, `ip`, `port`.

### send(endListener) ###
Sends the command sent in the args to the daemon. `endListener` is added as a listner for `end` which fires when the
command is sent.
`send` can return falsey if no command was sent (or `start` was sent and we're not spawning). See the Notes section
for why. If this fires the `error` event with the code `ECONNREFUSED` then the daemon probably isn't running.

To pipe the response back to another stream (like stdout) just run:
```
daemonctrl.send().pipe(process.stdout);
```

### fork(modulePath) ###
Tells `send()` to fork when the `start` command is sent and return an instance of ChildProcess. The `endListener`
is fired with a ChildProcess. If one of the arguments sent to the calling process is `-fork` or
`--fork` we will **NOT* pass that to the forked child as a helper to prevent infinite forking.

### listen(listeningListener) ###
This command is run from the daemon itself on start. When `listening` is fired you can start running your app.
`listeningListener` is added as a listener for the `listening` event. If this fires the `error` event with the code 
`EADDRINUSE` then the daemon is probably already running.

The `command` event is fired when a command is received. The listeners are sent `(command, commandArgs, socket)`.
You can respond to the sender by writing to the socket. You are **required** to `end` the socket. 

Example:
```
daemonctrl.listen(function() {
    myApp.run();
});
```
### end() ###
Stops listening. You should run this on process `SIGINT`, `SIGTERM`, and `exit`.

## strip() ##
Removes the command from `process.argv` if you use something that complains about invalid flags (like `node-flags`),
run this first.

## Notes ##

If you want to use the same script for sending and starting you just need to check to see if send returned a falsey value.
```
var sender = daemonctrl.send();
if (sender) {
    //send command to daemon
    sender.pipe(process.stdout);
    //beforeExit gets called when the event-loop is exausted which means the socket closed
    process.on('beforeExit', function() {
        process.stdout.write("\n");
    });
    return;
}
//running in the daemon since no command (or command was "start") was sent 
daemonctrl.listen(function() {
    myApp.run();
});
```

By [James Hartig](https://github.com/fastest963/)

# daemonctrl #

Control your daemon via the command line. A `command` is anything after the flags passed to a node script.

Example: `node send.js --flags [command]`

## Docs ##

### socketOptions(options) ###
Allows you to set options for how the socket is setup. This should be sent with the same params from the daemon
and sender.

Options are `path`, `ip`, `port`.

### send(endListener) ###
Sends the command sent in the args to the daemon. `endListener` is added as a listner for `end` which fires when the
command is sent.
`send` can return `undefined` if no command was sent. See the Notes section for why. If this fires the `error` event
with the code `ECONNREFUSED` then the daemon probably isn't running.

To pipe the response back to another stream (like stdout) just run:
```
daemonctrl.send().pipe(process.stdout);
```

### listen(listeningListener) ###
This command is run from the daemon itself on start. When `listening` is fired you can start running your app.
`listeningListener` is added as a listener for the `listening` event. If this fires the `error` event with the code 
`EADDRINUSE` then the daemon is probably already running.

Example:
```
daemonctrl.listen(function() {
    myApp.run();
});
```

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
    return;
}
//running in the daemon since no command (or command was "start") was sent 
daemonctrl.listen(function() {
    myApp.run();
});
```

By [James Hartig](https://github.com/fastest963/)

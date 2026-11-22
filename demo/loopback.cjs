const { Server } = require("node:net");

// The Playground CLI takes a port and otherwise binds on all interfaces.
const listen = Server.prototype.listen;
Server.prototype.listen = function (port, ...args) {
  if (port === 9417 && (args.length === 0 || typeof args[0] === "function")) {
    return listen.call(this, port, "127.0.0.1", ...args);
  }
  return listen.call(this, port, ...args);
};

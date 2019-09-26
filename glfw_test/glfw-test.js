//const window = require('bindings')('glwindow.node');
const glfw = require("./index.js")
//console.log(glfw)


if (!glfw.init()) {
	console.log("Failed to initialize glfw");
	process.exit(-1);
}
console.log(`glfw version  ${glfw.getVersion().join(".")}`);
console.log('glfw version-string: ' + glfw.getVersionString());

let monitors = glfw.getMonitors();
console.log(monitors)

let monitor = glfw.getPrimaryMonitor()
let pos = new Int32Array(2);
glfw.getMonitorPhysicalSize(monitor, pos, new Int32Array(pos.buffer, 4, 1))
console.log(pos)

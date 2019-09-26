//const glfw = require("node-glfw")
const EventEmitter = require('events');
const glfw = require("glfw-raub")
const { vec2, vec3, vec4, quat, mat2, mat2d, mat3, mat4} = require("gl-matrix")
const gl = require('../node-gles3/index.js') 
//const glutils = require('./glutils.js');
const glutils = require("./client/libs/glutils.js")

if (!glfw.init()) {
	console.log("Failed to initialize GLFW");
	process.exit(-1);
}
let version = glfw.getVersion();
console.log('glfw ' + version.major + '.' + version.minor + '.' + version.rev);
console.log('glfw version-string: ' + glfw.getVersionString());
let monitors = glfw.getMonitors();


let win = {
	dim: [1920*2, 1080],
	pos: [0, 0],
	title: "infranet",
	monitor: 1 % monitors.length,
	mode: "borderless",
}

// Open OpenGL window
glfw.defaultWindowHints();
glfw.windowHint(glfw.CONTEXT_VERSION_MAJOR, 3);
glfw.windowHint(glfw.CONTEXT_VERSION_MINOR, 3);
glfw.windowHint(glfw.OPENGL_FORWARD_COMPAT, 1);
glfw.windowHint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE);

// testing events
let emitter = new EventEmitter();
emitter.on('keydown',function(evt) {
	console.log("[keydown] ", (evt));
});
emitter.on('mousemove',function(evt) {
	console.log("[mousemove] "+evt.x+", "+evt.y);
});
emitter.on('mousewheel',function(evt) {
	console.log("[mousewheel] "+evt.position);
});
emitter.on('resize',function(evt){
	console.log("[resize] "+evt.width+", "+evt.height);
	win.dim[0] = evt.width
	win.dim[1] = evt.height
});


let window
if (win.mode == "fullscreen") {
	glfw.windowHint(glfw.DECORATED, glfw.FALSE);
	window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title); //, config.display)
} else if (win.mode == "borderless") {
	glfw.windowHint(glfw.DECORATED, glfw.FALSE);
	const monitor = monitors[win.monitor];
	window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title) //, config.display)
	//glfw.setWindowSize(window, monitor.width, monitor.height);
	//glfw.setWindowPos(window, monitor.pos_x, monitor.pos_y);
	glfw.setWindowSize(window, win.dim[0], win.dim[1]);
	glfw.setWindowPos(window, win.pos[0], win.pos[1]);
} else {
	glfw.windowHint(glfw.DECORATED, glfw.TRUE);
	window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title)
	glfw.setWindowPos(window, win.pos[0], win.pos[1]);
}

//let window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, "Test");
if (!window) {
	console.log("Failed to open GLFW window");
	glfw.terminate();
	process.exit(-1);
}
glfw.makeContextCurrent(window);
console.log(gl.glewInit());

// at least one pollEvents is needed to actually init the context
glfw.pollEvents()

//can only be called after window creation!
console.log('GL ' + glfw.getWindowAttrib(window, glfw.CONTEXT_VERSION_MAJOR) + '.' + glfw.getWindowAttrib(window, glfw.CONTEXT_VERSION_MINOR) + '.' + glfw.getWindowAttrib(window, glfw.CONTEXT_REVISION) + " Profile: " + glfw.getWindowAttrib(window, glfw.OPENGL_PROFILE));

glutils.glsl_version_string = `#version 330`

// Enable vertical sync (on cards that support it)
glfw.swapInterval(1); // 0 for vsync off


////////////////////////////////////

const shared = require("./client/shared.js")
const world = shared.world; 
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;


let newdata = null

const ws = require("ws")
const sock = new ws('ws://localhost:8080')
sock.on('open', function() {
	console.log("socket connected");
})
sock.on('close', function(e) {
	console.error("socket close", e)
})
sock.on('error', function(e) {
	console.error("socket err", e)
})
sock.on('message', function(data) {
	if (data instanceof ArrayBuffer) {
		newdata = data;
	} else if (data instanceof Buffer) {
		newdata = data.buffer;
	} else {
		console.log("socket data", data, typeof data)
	}
})

// const Socket = require("./client/libs/socket.js")
// const sock = new Socket({
// 	reload_on_disconnect: false,
// 	hostname: "localhost", port: 8080,

// 	onmessage: function(msg) {
// 		console.log("got message", msg);
// 	},
// 	onbuffer: function(data, byteLength) {
// 		//console.log("got buffer", byteLength, data);
// 		// copy data (arraybuffer) into shared:
// 		shared.dirty = true;
	
// 		newdata = data;
// 	},
// 	onerror: function(err) {
// 		console.error(err);
// 	},
// });


let pointsProgram = glutils.makeProgram(gl, `${glutils.glsl_version_string}
uniform mat4 u_projection;
uniform mat4 u_view;
uniform float u_pointsize;
uniform vec3 u_camera_position;
in vec4 a_position;
in vec4 a_color;
out vec4 color;
void main() {
	vec4 viewpos = u_view * a_position.xzyw;
	float camDist = length(viewpos.xyz);
	gl_Position = u_projection * viewpos;
	gl_PointSize = u_pointsize * 3.*2000./camDist;
	color = a_color;
}`,
`${glutils.glsl_version_string}
precision highp float;
in vec4 color;
out vec4 outColor;
void main() {
	float c = clamp(1. - 2.*length(0.5 - gl_PointCoord), 0., 1.);
	outColor = color * c;
}`);


const pointPositions = new Float32Array(NUM_AGENTS * 3);
const pointColors = new Float32Array(NUM_AGENTS * 4);
for (let i=0; i<NUM_AGENTS; i++) {
	pointPositions[i*3+0] = Math.random() * world.size[0];
	pointPositions[i*3+1] = Math.random() * world.size[1];
	pointPositions[i*3+2] = 0;

	pointColors[i*4+0] = Math.random();
	pointColors[i*4+1] = Math.random();
	pointColors[i*4+2] = Math.random();
	pointColors[i*4+3] = 1;
}
let pointsVao = glutils.createVao(gl, { 
	//vertices: shared.agent_positions,//pointPositions,
	colors: shared.agent_colors,//pointColors, 
}, pointsProgram.id)

pointsVao.bind()
{
	pointsVao.setAttribute("a_position", gl.createBuffer(), 2, shared.agent_positions);
	pointsVao.setAttribute("a_color", gl.createBuffer(), 4, shared.agent_colors);
}




let quadProgram = glutils.makeProgram(gl, `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
in vec4 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
out vec2 v_position;
void main() {
	gl_Position = u_projection * u_view * a_position.xzyw;
	v_position = a_position.xy;
	v_texCoord = a_texCoord;
}`,
`#version 300 es
precision highp float;
uniform sampler2D u_tex0;
uniform float u_brightness;
in vec2 v_texCoord;
in vec2 v_position;
out vec4 outColor;
void main() {
	vec4 t0 = texture(u_tex0, v_texCoord);
	
	float gridsize = 1./100.;
	float gridthickness = gridsize * 2.;
	vec2 grid = smoothstep(0.5-gridthickness, 0.5+gridthickness, abs(mod(v_position * gridsize, 1.)-0.5));
	float grid1 = max(grid.x, grid.y);

	outColor = vec4(t0) * u_brightness; 
	//outColor += vec4(v_texCoord, 0.3, 0.5);
}`)
let quad = glutils.makeQuad();
quad.vertices = new Float32Array([
	0, 0,		
	world.size[0], 0,
	world.size[0], world.size[1], 		
	0, world.size[1],
]);
let quadVao = glutils.createVao(gl, quad, quadProgram.id);

let inputfbo_subdiv = 1
let inputfbo = glutils.createFBO(gl, world.size[0]/inputfbo_subdiv, world.size[1]/inputfbo_subdiv, true, true);


// //////////////////////////////

let t = glfw.getTime();
let fps = 60;

function update() {

	if (newdata) {
		new Uint8Array(shared.buffer).set(new Uint8Array(newdata));
		newdata = null;

		// linesVao.bind();
		// gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, linesVao.indexBuffer);
		// gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shared.line_indices, //lineIndices, 
		// 	gl.STREAM_DRAW);
		// linesVao.unbind();
		
		pointsVao.bind();
		gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.attributes.a_position.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, shared.agent_positions,//pointPositions
			gl.STREAM_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.attributes.a_color.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, shared.agent_colors, 
			gl.STREAM_DRAW);
		pointsVao.unbind();
	}
	
	glfw.pollEvents();
	if (glfw.windowShouldClose(window) || glfw.getKey(window, glfw.KEY_ESCAPE)) {
		// Close OpenGL window and terminate GLFW
		glfw.destroyWindow(window);
		glfw.terminate();

		process.exit(0);
	}

	let t1 = glfw.getTime();
	let dt = t1-t;
	fps += 0.1*((1/dt)-fps);
	t = t1;
	glfw.setWindowTitle(window, `fps ${fps} @time ${t}`);
	if (t % 5 < dt) {
		console.log(`fps ${fps} @time ${t}`)
	}
	
	// Get window size (may be different than the requested size)
	let dim = glfw.getFramebufferSize(window);
	//if(wsize) console.log("FB size: "+wsize.width+', '+wsize.height);

	world.t = t;

	//////////////////
	let view = mat4.create(), projection = mat4.create();
	let camera_position = vec3.create();
	let view_fbo = mat4.create();
	let projection_fbo = mat4.create();
	let camera_position_fbo = vec3.create();

	// set up camera:
	const centre = [world.size[0]/2, 0, world.size[1]/2]
	{
		let zoom = 1;
		const far = centre[2];
		const near = 1;
		mat4.ortho(projection_fbo, 
			-centre[0]/zoom, 
			+centre[0]/zoom,
			-centre[2]/zoom, 
			+centre[2]/zoom,
			near, far);
		camera_position_fbo = [centre[0], -(far-near), centre[2]];
		const up = [0, 0, 1];
		mat4.lookAt(view_fbo, camera_position_fbo, centre, up);
	}
	if (1) {

		const zm = 1. + 0.5*(Math.cos(world.t / 31))

		const near = 1;
		const far = world.size[0];
		mat4.perspective(projection, 
			Math.PI/3, 
			win.dim[0]/win.dim[1],
			near, far);
		
		const angle = world.t * 0.1;
		const d = zm * far/16;
		const x = Math.cos(angle);
		const z = Math.sin(angle);

		const centrex = world.size[0] * (0.5 + 0.2*Math.sin(world.t * 0.03));
		const centrey = world.size[1] * (0.5 + 0.05*Math.sin(world.t * 0.023));
		const centre = [
			centrex - d*x, 
			0, 
			centrey - d*z
		];
		
		vec3.set(camera_position, 
			centrex + d*x, 
			far/32 * (1 + 0.3*Math.sin(world.t * 0.02)), 
			centrey + d*z
		);
		const up = [-x, 0, -z];
		mat4.lookAt(view, camera_position, centre, up);
	}

	inputfbo.begin().clear();
	{
		gl.enable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		//gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.depthMask(false);

		//gl.useProgram(pointsProgram.id)
		pointsProgram.begin()
			.uniform("u_projection", projection_fbo)
			.uniform("u_view", view_fbo)
			.uniform("u_camera_position", camera_position_fbo)
			.uniform("u_pointsize", 2);
		pointsVao.bind().drawPoints(NUM_AGENTS).unbind();

		// linesProgram.begin()
		// 	.uniform("u_projection", projection_fbo)
		// 	.uniform("u_view", view_fbo)
		// 	.uniform("u_camera_position", camera_position_fbo)
		// linesVao.bind().drawLines().unbind();

		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(true);
	}
	inputfbo.end();

	gl.viewport(0, 0, win.dim[0], win.dim[1]);
	gl.clearColor(0, 0, 0, 1)
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.enable(gl.BLEND);
	gl.disable(gl.DEPTH_TEST);
	//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	//gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
	//gl.blendFunc(gl.ONE, gl.ONE);
	gl.depthMask(false);


	quadVao.bind()
	quadProgram.begin()
	quadProgram.uniform("u_projection", projection)
		.uniform("u_view", view)
		.uniform("u_tex0", 0)
	//	.uniform("u_brightness", 0.4)
	// world.streetsTex.bind()
	// quadVao.draw();

	quadProgram.uniform("u_brightness", 1)
	inputfbo.front.bind(0)
	quadVao.draw();
	//trailfbo.front.bind(0)
	//quadVao.draw()
	//syncfbo.front.bind(0)
	//quadVao.draw()
	quadVao.unbind();
	// Swap buffers
	glfw.swapBuffers(window);

	setImmediate(update)
}

update();

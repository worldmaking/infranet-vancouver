//const glfw = require("node-glfw")
const EventEmitter = require('events');
const glfw = require("glfw-raub")
const { vec2, vec3, vec4, quat, mat2, mat2d, mat3, mat4} = require("gl-matrix")
const gl = require('../node-gles3/index.js') 
//const glutils = require('./glutils.js');
const glutils = require("./client/libs/glutils.js")
//glutils.glsl_version_string = `#version 330`



if (!glfw.init()) {
	console.log("Failed to initialize GLFW");
	process.exit(-1);
}
let version = glfw.getVersion();
console.log('glfw ' + version.major + '.' + version.minor + '.' + version.rev);
console.log('glfw version-string: ' + glfw.getVersionString());

let monitors = glfw.getMonitors();
console.log(monitors)



////////////////////////////////////

const shared = require("./client/shared.js")
const world = shared.world; 
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;

const centre = [world.size[0]/2, 0, world.size[1]/2]
let view = mat4.create(), projection = mat4.create();
let camera_position = vec3.create();
let view_fbo = mat4.create();
let projection_fbo = mat4.create();
let camera_position_fbo = vec3.create();


let inputfbo_subdiv = 2
let trailfbo_subdiv = 2
let syncfbo_subdiv = 4
let sharpness = 0.8;
let gamma = 2.27;
let composite_mix = [1, 1, 0.25];

// const pointPositions = new Float32Array(NUM_AGENTS * 3);
// const pointColors = new Float32Array(NUM_AGENTS * 4);
// for (let i=0; i<NUM_AGENTS; i++) {
// 	pointPositions[i*3+0] = Math.random() * world.size[0];
// 	pointPositions[i*3+1] = Math.random() * world.size[1];
// 	pointPositions[i*3+2] = 0;

// 	pointColors[i*4+0] = Math.random();
// 	pointColors[i*4+1] = Math.random();
// 	pointColors[i*4+2] = Math.random();
// 	pointColors[i*4+3] = 1;
// }
// const lineIndices = new Uint16Array(MAX_LINE_POINTS);
// for (let i=0; i<MAX_LINE_POINTS; i++) {
// 	lineIndices[i] = i % NUM_AGENTS;
// }
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

//////////////////////////////////

function Window(win) {


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
		win.dim = [evt.width, evt.height]
	});

	let window
	if (win.mode == "fullscreen") {
		glfw.windowHint(glfw.DECORATED, glfw.FALSE);
		window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title); //, config.display)
	} else if (win.mode == "borderless") {
		glfw.windowHint(glfw.DECORATED, glfw.FALSE);
		const monitor = monitors[win.monitor];
		window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title) //, config.display)
		glfw.setWindowSize(window, monitor.width, monitor.height);
		glfw.setWindowPos(window, monitor.pos_x, monitor.pos_y);
	} else {
		glfw.windowHint(glfw.DECORATED, glfw.TRUE);
		window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title)
		glfw.setWindowPos(window, win.pos[0], win.pos[1]);
	}
	//let window = glfw.createWindow(win.dim[0], win.dim[1], { emit: (t, e) => emitter.emit(t, e) }, win.title);
	if (!window) {
		console.log("Failed to open GLFW window");
		glfw.terminate();
		process.exit(-1);
	}
	glfw.makeContextCurrent(window);
	console.log(gl.glewInit());

	win.handle = window;

	// at least one pollEvents is needed to actually init the context
	glfw.pollEvents()
	

	//can only be called after window creation!
	console.log('GL ' + glfw.getWindowAttrib(window, glfw.CONTEXT_VERSION_MAJOR) + '.' + glfw.getWindowAttrib(window, glfw.CONTEXT_VERSION_MINOR) + '.' + glfw.getWindowAttrib(window, glfw.CONTEXT_REVISION) + " Profile: " + glfw.getWindowAttrib(window, glfw.OPENGL_PROFILE));
	console.log(win)

	// Enable vertical sync (on cards that support it)
	glfw.swapInterval(0); // 0 for vsync off


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

	

	let pointsVao = glutils.createVao(gl, { 
		colors: shared.agent_colors,
	}, pointsProgram.id)
	pointsVao.bind()
	{
		pointsVao.setAttribute("a_position", gl.createBuffer(), 2, shared.agent_positions);
		pointsVao.setAttribute("a_color", gl.createBuffer(), 4, shared.agent_colors);
	}

	
	let linesProgram = glutils.makeProgram(gl, 
	`${glutils.glsl_version_string}
	uniform mat4 u_projection;
	uniform mat4 u_view;
	uniform vec3 u_camera_position;
	in vec4 a_position;
	in vec4 a_color;
	out vec4 color;
	void main() {
		vec4 viewpos = u_view * a_position.xzyw;
		float camDist = length(viewpos.xyz);
		gl_Position = u_projection * viewpos;
		color = a_color;
	}
	`, 
	`${glutils.glsl_version_string}
	precision mediump float;
	in vec4 color;
	out vec4 outColor;
	void main() {
		outColor = color;
	}
	`);
	
	// make a new Vao for lines, with only indices defined:
	let linesVao = glutils.createVao(gl, {
		indices: shared.line_indices, 
	}, linesProgram.id);
	
	// now also map in the points/colours but re-use the buffers from pointsVao:
	linesVao.bind()
	{
		linesVao.setAttribute("a_position", pointsVao.attributes.a_position.buffer, 2);
		linesVao.setAttribute("a_color", pointsVao.attributes.a_color.buffer, 4);
	}

	let quadProgram = glutils.makeProgram(gl, `${glutils.glsl_version_string}
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
	`${glutils.glsl_version_string}
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

	let inputfbo = glutils.createFBO(gl, world.size[0]/inputfbo_subdiv, world.size[1]/inputfbo_subdiv, true, true);

	let trailfbo = glutils.createFBO(gl, world.size[0]/trailfbo_subdiv, world.size[1]/trailfbo_subdiv, true, true);
	let slab_trail = glutils.createSlab(gl, `${glutils.glsl_version_string}
	precision highp float;
	uniform sampler2D u_tex0; // feedback
	uniform sampler2D u_tex1; // new data from fbo
	//uniform sampler2D u_tex4; // world data
	uniform float u_fade;
	in vec2 v_texCoord;
	out vec4 outColor;
	void main() {
		vec3 tex0 = texture(u_tex0, v_texCoord).rgb;
		vec3 tex1 = texture(u_tex1, v_texCoord).rgb;
		//vec4 data = texture(u_tex4, v_texCoord);
		float avg = length(tex0.r + tex0.g + tex0.b)/3.;
		vec3 col = mix(vec3(avg), tex0.rgb, u_fade);
		outColor.rgb = col*u_fade + tex1.rgb;
		outColor.a = 1.;
	}
	`,{
		"u_tex0": [0],
		"u_tex1": [1],
		u_tex4: [4],
		"u_fade": [0.99],
	});

	let syncfbo = glutils.createFBO(gl, world.size[0]/syncfbo_subdiv, world.size[1]/syncfbo_subdiv, true, true);
	let slab_sync = glutils.createSlab(gl, `${glutils.glsl_version_string}
	precision highp float;
	uniform sampler2D u_tex0; // feedback
	uniform sampler2D u_tex1; // new input
	//uniform sampler2D u_tex4;
	uniform float u_fade;
	uniform vec2 u_resolution;
	in vec2 v_texCoord;
	out vec4 outColor;


	vec4 blur(sampler2D img, vec2 uv) {
		float r = 1.5;
		vec2 s = vec2(r/u_resolution.x, r/u_resolution.y);
		vec4 p = vec4(s.x, s.y, -s.x, -s.y);
		float a = 0.25;
		float b = 0.5;
		return (
			texture(img, uv+(p.xy))
			+ texture(img, uv+(p.zw))
			+ texture(img, uv+(p.zy))
			+ texture(img, uv+(p.xw))
		) * 0.25;
	}

	void main() {
		// vec4 data = texture(u_tex4, v_texCoord);
		// float block = (1. - data.r);
		// float fade =  mix(u_fade, 0.995, clamp((data.b+data.g)*3.-0.5, 0., 1.));
		float fade = u_fade;

		vec4 tex1 = texture(u_tex1, v_texCoord);
		outColor.rgb = blur(u_tex0, v_texCoord).rgb * fade;

		outColor.rgb = max(outColor.rgb, tex1.rgb);

		// TODO re-enable
		// // block by buildings:
		// vec3 blocked = min(outColor.rgb, block);
		// outColor.rgb = mix(outColor.rgb, blocked, 0.25);

		outColor.a = 1.;

		//outColor = tex1;

	}
	`,{
		"u_tex0": [0],
		"u_tex1": [1],
		u_tex4: [4],
		"u_fade": [0.99],
		"u_resolution": world.size,
	});

	let slab_composite_invert = 0;
	let slab_composite = glutils.createSlab(gl, `${glutils.glsl_version_string}
	precision highp float;

	uniform sampler2D u_agents;
	uniform sampler2D u_sync;
	uniform sampler2D u_trails;
	uniform sampler2D u_areas;
	uniform sampler2D u_data;

	uniform mat3 u_final;

	// uniform sampler2D u_image;
	// uniform sampler2D u_map;
	uniform vec4 u_color;
	uniform float u_invert;
	uniform float u_showmap;
	uniform float u_sharpness;
	uniform float u_gamma;

	uniform vec3 u_mix;
	in vec2 v_texCoord;
	out vec4 outColor;

	vec4 blur(sampler2D img, vec2 uv) {
		float r = 1.;
		vec2 s = vec2(r/3231., r/2160.);
		vec4 p = vec4(s.x, s.y, -s.x, -s.y);
		float a = 0.25;
		float b = 0.5;
		vec4 bl = (
			texture(img, uv+(p.xy))
			+ texture(img, uv+(p.zw))
			+ texture(img, uv+(p.zy))
			+ texture(img, uv+(p.xw))
		) * 0.25;
		return mix(bl, texture(img, uv), u_sharpness);
	}


	vec4 blurred(sampler2D img, vec2 uv) {
		vec2 texSize = vec2(3231, 2160);
		vec2 onePixel = vec2(1.0, 1.0) / texSize;

		vec4 image0 = texture(img, uv);
		vec4 image1 = texture(img, uv+vec2(onePixel.x, 0.));
		vec4 image2 = texture(img, uv+vec2(0., onePixel.y));
		vec4 image3 = texture(img, uv+vec2(onePixel.x, onePixel.y));
		return mix((image0 + image1 + image2 + image3) / 4., image0, u_sharpness);
	}

	void main() {

		vec2 uv = (u_final * vec3(v_texCoord.xy, 1)).xy;
		vec2 uv1 = vec2(uv.x, 1.-uv.y);

		// vec4 data = texture(u_data, uv1);
		// float ways = data.r;
		// float altitude = data.g;
		// float areas = data.b;
		// float marks = data.a;

		vec4 areacolors = texture(u_areas, uv1);

		vec4 agents = texture(u_agents, uv);
		vec4 sync = blur(u_sync, uv) * 0.7; 
		vec4 trails = blur(u_trails, uv);

		vec4 data = texture(u_data, uv);

		float trailsgamma = 1.2;
		trails.rgb = pow(trails.rgb, vec3(1.0/trailsgamma)) * u_mix.z;

		float aaa = max(agents.r, max(agents.b, agents.g));
		outColor.rgb = max(sync.rgb + trails.rgb, aaa); 
		outColor.rgb *= areacolors.a;
		outColor.rgb = mix(outColor.rgb, 1.-outColor.rgb, u_invert);
		outColor.a = 1.;
		outColor.rgb = pow(outColor.rgb, vec3(1.0/u_gamma));


		//outColor = sync;
	}
	`,{
		"u_agents": [0],
		"u_sync": [1],
		"u_trails": [2],
		u_mix: composite_mix,
		"u_areas": [3],
		u_data: [4],
		"u_color": [1, 1, 1, 1],
		"u_invert": [slab_composite_invert],
		u_gamma: [1],
		//"u_showmap": [showmap ? 1 : 0],
		"u_sharpness": [0.5],
	})

	win.updateGPU = function(){
		
		linesVao.bind();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, linesVao.indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shared.line_indices, //lineIndices, 
			gl.STREAM_DRAW);
		linesVao.unbind();

		pointsVao.bind();
		gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.attributes.a_position.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, shared.agent_positions,//pointPositions
			gl.STREAM_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.attributes.a_color.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, shared.agent_colors, 
			gl.STREAM_DRAW);
		pointsVao.unbind();
	
	}

	win.draw = function() {
		
		glfw.makeContextCurrent(window);
		// Get window size (may be different than the requested size)
		let dim = glfw.getFramebufferSize(window);
		//if(wsize) console.log("FB size: "+wsize.width+', '+wsize.height);

		
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

		// feed into trails:
		trailfbo.begin().clear();
		{
			trailfbo.front.bind(0);
			inputfbo.front.bind(1);
			slab_trail.use();
			//slab_trail.uniform("u_fade", 0.997);
			slab_trail.draw();
		}
		trailfbo.end();

		// feed into sync lighting:
		syncfbo.begin().clear();
		{
			syncfbo.front.bind(0);
			inputfbo.front.bind(1);
			//world.data.bind(4);
			slab_sync.use()
		 //slab_sync.uniform("u_fade", 0.96);
			slab_sync.draw();
		}
		syncfbo.end(); 

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
		trailfbo.front.bind(0)
		quadVao.draw()
		// syncfbo.front.bind(0)
		// quadVao.draw()
		quadVao.unbind();

		// linesProgram.begin()
		// 	.uniform("u_projection", projection)
		// 	.uniform("u_view", view)
		// 	.uniform("u_camera_position", camera_position)
		// linesVao.bind().drawLines().unbind();
		
		// pointsProgram.begin()
		// 	.uniform("u_projection", projection)
		// 	.uniform("u_view", view)
		// 	.uniform("u_camera_position", camera_position)
		// 	.uniform("u_pointsize", 2);
		// pointsVao.bind();
		// gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
		// pointsVao.unbind();
		


		gl.enable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.depthMask(true);

		// Swap buffers
		glfw.swapBuffers(window);
	}

	return win;
}

let windows = [
	Window({ 
		title: "infranet1",
		dim: [1920 / 2, 1080 / 2],
		pos: [20, 20],
		monitor: 0,
	}),
	Window({ 
		title: "infranet2",
		dim: [1920 / 2, 1080 / 2],
		pos: [520, 20],
		monitor: (1 % monitors.length),
		mode: "borderless"
	}),
];

// //////////////////////////////

let t = glfw.getTime();
let fps = 60;

function update() {
	
	glfw.pollEvents();

	for (let win of windows) {
		if (glfw.windowShouldClose(win.handle) || glfw.getKey(win.handle, glfw.KEY_ESCAPE)) {
			// Close OpenGL window and terminate GLFW
			for (let win1 of windows) glfw.destroyWindow(win1.handle);
			glfw.terminate();
			process.exit(0);
			break;
		}
	}
	
	setImmediate(update)

	let t1 = glfw.getTime();
	let dt = t1-t;
	fps += 0.1*((1/dt)-fps);
	t = t1;
	glfw.setWindowTitle(windows[0].handle, `fps ${fps} @time ${t}`);
	if (t % 5 < dt) {
		console.log(`fps ${fps} @time ${t}`)
	}
	
	world.t = t;

	//////////////////
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
			1, //windows[0].dim[0] / windows[0].dim[1],
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

	if (newdata) {
		new Uint8Array(shared.buffer).set(new Uint8Array(newdata));
		newdata = null;

		for (let win of windows) win.updateGPU();
	}

	for (let win of windows) win.draw();

}

update();

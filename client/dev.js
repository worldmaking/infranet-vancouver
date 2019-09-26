
// don't run script until everything is loaded:
window.addEventListener('load', init);

window.addEventListener("keydown", function(e) {
	console.log("keycode", e.keyCode);

	if (e.keyCode == 70) { // F
		screenfull.toggle()
	}
}, true);

//console.log(shared)


const { vec2, vec3, vec4, quat, mat3, mat4 } = glMatrix;


// true globals:
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;
const world = shared.world; 
world.t0 = performance.now();
world.t = 0;

let newdata = null;

let debugLevel = 4;
let sharpness = 0.8;
let gamma = 2.27;
let composite_mix = [1, 1, 0.25];
let inputfbo_subdiv = 1
let trailfbo_subdiv = 2
let syncfbo_subdiv = 2

const canvas = document.getElementById("canvas");
const rect = canvas.getBoundingClientRect();
let page_ratio = (rect.width/rect.height);
let world_ratio = world.size[0]/world.size[1];
function resize() {	
	// // Get the device pixel ratio, falling back to 1.
	// const dpr = window.devicePixelRatio || 1;
	// // Get the size of the canvas in CSS pixels.
	const rect = canvas.getBoundingClientRect();
	page_ratio = (rect.width/rect.height);
	canvas.width = rect.width; // * page_ratio / world_ratio;
	canvas.height = rect.height;
}
resize();
window.addEventListener("resize", resize);


const gl = canvas.getContext("webgl2", {
	//antialias: false,
	//alpha: true
});
console.log(gl)
if (!gl) {
	alert("Browser error: unable to acquire webgl2 context");
}
if (!gl.getExtension("EXT_color_buffer_float")) {
	alert("Browser error: need EXT_color_buffer_float");
}
if (!gl.getExtension("OES_texture_float_linear")) {
	alert("couldn't get float texture interpolation")
}

let pointsProgram = glutils.makeProgram(gl, `#version 300 es
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
	float luma = color.a; //max(color.r, max(color.g, color.b));
	color.a = sqrt(luma);
	gl_PointSize = 1.+ u_pointsize * color.a * 2.;
}`,
`#version 300 es
precision highp float;
in vec4 color;
out vec4 outColor;
void main() {
	float c = clamp(1. - 2.*length(0.5 - gl_PointCoord), 0., 1.);
	
	// greyscale it:
	float luma = color.a; //max(color.r, max(color.g, color.b));
	outColor = vec4(c * luma * 1.5);
	
	outColor = vec4(color.rgb, c);
	//outColor = vec4(vec3(0.5), c * color.a);
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

let linesProgram = glutils.makeProgram(gl, 
`#version 300 es
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
`#version 300 es
precision mediump float;
in vec4 color;
out vec4 outColor;
void main() {
	outColor = color;
	outColor.a = 1.;
}
`);

const lineIndices = new Uint16Array(MAX_LINE_POINTS);
for (let i=0; i<MAX_LINE_POINTS; i++) {
	lineIndices[i] = i % NUM_AGENTS;
}

// make a new Vao for lines, with only indices defined:
let linesVao = glutils.createVao(gl, {
	indices: shared.line_indices, //lineIndices,
}, linesProgram.id);

// now also map in the points/colours but re-use the buffers from pointsVao:
linesVao.bind()
{
	linesVao.setAttribute("a_position", pointsVao.attributes.a_position.buffer, 2);
	linesVao.setAttribute("a_color", pointsVao.attributes.a_color.buffer, 4);
}






// let linesVao = createVao(gl, { 
// 	vertices: pointPositions,
// 	colors: pointColors, 
// 	indices: lineIndices,
// }, linesProgram.id)

// linesVao.bind();
// gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.vertexBuffer);
// let attrLoc = gl.getAttribLocation(program, "a_color");
// gl.enableVertexAttribArray(attrLoc);
// gl.bindBuffer(gl.ARRAY_BUFFER, pointsVao.colorBuffer);
// linesVao.vertexBuffer = pointsVao.vertexBuffer;
// linesVao.colorBuffer = pointsVao.colorBuffer;

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
	//outColor += vec4(0, 0, 0.3, 0);
	outColor.a = 1.;
}`)
let quad = glutils.makeQuad();
quad.vertices = new Float32Array([
	0, 0,		
	world.size[0], 0,
	world.size[0], world.size[1], 		
	0, world.size[1],
]);
let quadVao = glutils.createVao(gl, quad, quadProgram.id);

var stats = new Stats();
document.body.appendChild( stats.dom );
stats.domElement.style.top = '30px';

console.log("render resoluotion:", gl.canvas.width, gl.canvas.height)

function init() {

	
	function updateGPU() {
		if (newdata) {
			new Uint8Array(shared.buffer).set(new Uint8Array(newdata));
			newdata = null;

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

		

	}
		
	// now main render routine:
	function update() {

		let t1 = (performance.now() - world.t0) * 0.001;
		let dt = t1 - world.t;
		world.t = t1;
		stats.update();

		//animate(dt);
		updateGPU();
	

		//	requestAnimationFrame(update);
		
		
		let view = mat4.create(), projection = mat4.create();
		let camera_position = vec3.create();

		let view_fbo = mat4.create();
		let projection_fbo = mat4.create();

		// set up camera:
		const centre = [world.size[0]/2, 0, world.size[1]/2]
		{
			let zoom = 3;
			let aspect = page_ratio/world_ratio
			const far = centre[2];
			const near = 1;
			mat4.ortho(projection_fbo, 
				-centre[0] * aspect/zoom, 
				+centre[0] * aspect/zoom,
				+centre[2]/zoom, 
				-centre[2]/zoom,
				near, far);
			let tri = Math.abs(((world.t / 50.) % 4) - 2) - 1.;
			camera_lookat = [centre[0] * (1 + 0.35*tri), 0, centre[2]];;
			camera_position_fbo = [camera_lookat[0], -(far-near), centre[2]];
			const up = [0, 0, 1];
			mat4.lookAt(view_fbo, camera_position_fbo, camera_lookat, up);
		}


		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		gl.enable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		//gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		//gl.blendFunc(gl.ONE, gl.ONE);
		gl.depthMask(false);
		
		projection = projection_fbo;
		view = view_fbo;
		camera_position = camera_position_fbo;

		// quadProgram.begin()
		// .uniform("u_projection", projection)
		// .uniform("u_view", view)
		// .uniform("u_tex0", 0)
		// .uniform("u_brightness", 0.5)
		// world.streetsTex.bind()
		// quadVao.bind().draw().unbind()

		linesProgram.begin()
			.uniform("u_projection", projection)
			.uniform("u_view", view)
			.uniform("u_camera_position", camera_position)
		linesVao.bind().drawLines(shared.params[0]).unbind();
		//console.log("num lines:", shared.params[0])

		pointsProgram.begin()
			.uniform("u_projection", projection)
			.uniform("u_view", view)
			.uniform("u_camera_position", camera_position)
			.uniform("u_pointsize", 6);
		pointsVao.bind();
		gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
		pointsVao.unbind();
		


		gl.enable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.depthMask(true);

		
		//console.log("tick")
		requestAnimationFrame(update);
	}
	
	update();

	
}

const sock = new Socket({
	reload_on_disconnect: true,
});

sock.onmessage = function(msg) {
	if (msg.cmd == "watchers") {
		//grid = msg.grid
	} else if (msg.cmd == "video") {
		console.log("reload video", msg.url)

		let video = document.getElementById("vid")
		// var sources = video.getElementsByTagName('source');
		// sources[0].src = msg.url;
		// video.load();
		let vid_mp4 = document.getElementById("vid_mp4");
		vid_mp4.setAttribute("src", msg.url);
		video.load();
    	video.play();
	} else {
		console.log(msg)
	}
	
}
sock.onbuffer = function(data, byteLength) {
	//console.log("got buffer", byteLength, data);
	// copy data (arraybuffer) into shared:
	shared.dirty = true;

	newdata = data;
}


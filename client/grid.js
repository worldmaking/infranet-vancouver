
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

let grid

// true globals:
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;
const world = shared.world; 
world.t0 = performance.now();
world.t = 0;

// TODO: compute
let grid_colsize = 170;
let grid_rowsize = 205;

let newdata = null;

let debugLevel = 4;
let sharpness = 0.8;
let gamma = 2.27;
let composite_mix = [1, 1, 0.25];
let inputfbo_subdiv = 1

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

//let glcanvas = document.createElement("canvas");
const glcanvas = document.getElementById("glcanvas");
glcanvas.width = world.size[0]
glcanvas.height = world.size[1]
//document.getElementById("glcanvas");
//let glcanvas = document.createElement("canvas");

let gl = glcanvas.getContext("webgl2", {
	antialias: false,
	alpha: false
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

let inputfbo = glutils.createFBO(gl, world.size[0]/inputfbo_subdiv, world.size[1]/inputfbo_subdiv, true, true);


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
	
	//outColor = vec4(color.rgb, c * color.a * 2.);
	outColor = vec4(vec3(1), c * color.a);

	//outColor = vec4(color.rgb, c);
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
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
	gl_Position = u_projection * u_view * vec4(a_position, 0., 1.);
	v_texCoord = a_texCoord;
}`,
`#version 300 es
precision highp float;
uniform sampler2D u_tex0;
uniform float u_brightness;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
	vec4 t0 = texture(u_tex0, v_texCoord);
	
	outColor = vec4(t0) * u_brightness; 
	//outColor += vec4(v_texCoord, 0., 0.5);
	//outColor += vec4(0, 0, 0.3, 0);
	outColor.a = 1.;
}`)
let quadVao = glutils.createVao(gl, glutils.makeQuad(), quadProgram.id);

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

		requestAnimationFrame(update);

		if (sock.socket && sock.socket.readyState === WebSocket.OPEN) {
			sock.send({ cmd: "getwatchers" });
		}
		if (!grid) return; // not ready yet


		let t1 = (performance.now() - world.t0) * 0.001;
		let dt = t1 - world.t;
		world.t = t1;
		stats.update();

		//animate(dt);
		updateGPU();
	

		//	requestAnimationFrame(update);
		
		
		let view_fbo = mat4.create();
		let projection_fbo = mat4.create();
		{
			const centre = [world.size[0]/2, 0, world.size[1]/2]
			let aspect = inputfbo.width / inputfbo.height;
			const near = 1;
			const far = centre[2];
			mat4.ortho(projection_fbo, 
				-centre[0], 
				+centre[0],
				+centre[2], 
				-centre[2],
				near, far);

			camera_lookat = centre;
			camera_position_fbo = [camera_lookat[0], -1, camera_lookat[2]];
			const up = [0, 0, 1];
			mat4.lookAt(view_fbo, camera_position_fbo, camera_lookat, up);
		}
		
		// inputfbo.begin().clear()
		// {
		// 	gl.viewport(0, 0, inputfbo.width, inputfbo.height);
		// 	gl.clearColor(0, 0, 0, 1)
		// 	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// 	gl.enable(gl.BLEND);
		// 	gl.disable(gl.DEPTH_TEST);
		// 	//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		// 	//gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		// 	gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		// 	//gl.blendFunc(gl.ONE, gl.ONE);
		// 	gl.depthMask(false);


		// 	linesProgram.begin()
		// 		.uniform("u_projection", projection_fbo)
		// 		.uniform("u_view", view_fbo)
		// 		.uniform("u_camera_position", camera_position_fbo)
		// 	linesVao.bind().drawLines(shared.params[0]).unbind();
		// 	//console.log("num lines:", shared.params[0])

		// 	pointsProgram.begin()
		// 		.uniform("u_projection", projection_fbo)
		// 		.uniform("u_view", view_fbo)
		// 		.uniform("u_camera_position", camera_position_fbo)
		// 		.uniform("u_pointsize", 3);
		// 	pointsVao.bind();
		// 	gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
		// 	pointsVao.unbind();


		// 	gl.enable(gl.DEPTH_TEST);
		// 	gl.depthMask(true);
		// }
		// inputfbo.end();

		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
		// gl.clearColor(0, 0, 0, 1)
		// gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// let projection = mat4.create()
		// let view = mat4.create()

		// let aspect = gl.canvas.width / gl.canvas.height
		// mat4.ortho(projection, -1, 1, -1, 1, 0, 2);
		
		// quadVao.bind()
		// quadProgram.begin()
		// 	.uniform("u_projection", projection)
		// 	.uniform("u_view", view)
		// 	.uniform("u_tex0", 0)
		// 	.uniform("u_brightness", 1.)
		
		// quadProgram.uniform("u_brightness", 1)
		// inputfbo.front.bind(0)
		// quadVao.draw()
		// quadVao.unbind();

		{
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

			gl.enable(gl.BLEND);
			gl.disable(gl.DEPTH_TEST);
			//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			//gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			//gl.blendFunc(gl.ONE, gl.ONE);
			gl.depthMask(false);


			linesProgram.begin()
				.uniform("u_projection", projection_fbo)
				.uniform("u_view", view_fbo)
				.uniform("u_camera_position", camera_position_fbo)
			linesVao.bind().drawLines(shared.params[0]).unbind();
			//console.log("num lines:", shared.params[0])

			pointsProgram.begin()
				.uniform("u_projection", projection_fbo)
				.uniform("u_view", view_fbo)
				.uniform("u_camera_position", camera_position_fbo)
				.uniform("u_pointsize", 3);
			pointsVao.bind();
			gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
			pointsVao.unbind();


			gl.enable(gl.DEPTH_TEST);
			gl.depthMask(true);
		}

		
		let ctx = canvas.getContext("2d", { antialias: false, alpha: false});
		ctx.fillStyle =  "black" ;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		let smooth = true;
		ctx.mozImageSmoothingEnabled = smooth;
		ctx.webkitImageSmoothingEnabled = smooth;
		ctx.imageSmoothingQuality = "high";
		ctx.msImageSmoothingEnabled = smooth;
		ctx.imageSmoothingEnabled = smooth;
		let fontsize = 11;
		ctx.font = fontsize + 'px sans-serif';
		ctx.font = fontsize + 'px calibri';
		ctx.font = fontsize + 'px helvetica';
		//ctx.font = fontsize + 'px monospace';
		ctx.textBaseline = "top"
		ctx.textAlign = "left"
		ctx.fillStyle = "#666" ;
		let fontcolor = "#999"

		let mapbox = Math.floor(grid_colsize*3/4) / 2;
		let mapbox2 = mapbox * 2
		let glaspect = gl.canvas.width / gl.canvas.height;
		let i=0;
		for (let y=0; y<grid.rows; y++) {
			for (let x=0; x<grid.cols; x++, i++) {
				let watcher = grid.watchers[i];

				let ax = watcher.pos[0];
				let ay = watcher.pos[1];

				let glh = mapbox2*watcher.zoom; //grid.zooms[i];
				let glw = glh
				let glh2 = glh*2;
				let glw2 = glw*2;

				let sx = mapbox2 / glw2
				let sy = mapbox2 / glh2

				let px = grid_colsize*(x + 1/4);
				let py = grid_rowsize*(y + 1/4);
				
				if (watcher.reward > 0.1) {
					//ctx.fillStyle = "white";
					//ctx.fillRect(px, py, mapbox2, mapbox2);
					ctx.drawImage(gl.canvas, 
						ax-glw, ay-glh, glw2, glh2,
						px, py, mapbox2, mapbox2);
					
					// offset (canvas pixels) from box centre to agent centre
					let aax = (watcher.agentpos[0] - ax) * sx
					let aay = (watcher.agentpos[1] - ay) * sy
					// radius of agent highlight
					let b = 4 * sx;
					// bounds of highlight relative to box:
					let bl = aax-b, br = aax+b, bb = aay-b, bt = aay+b
					if (bl > -mapbox && br < mapbox && bb > -mapbox && bt < mapbox) {
						// draw highlight:
						ctx.strokeStyle = "#ccc";
						ctx.strokeRect(px+mapbox+bl, py+mapbox+bb, b*2, b*2);

						// ctx.beginPath();
						// ctx.arc(px+mapbox+aax, py+mapbox+aay, b, -Math.PI, Math.PI);
						// ctx.stroke();
					}

					ctx.fillStyle = fontcolor
					let ty = py+mapbox2 + 3;
					ctx.fillText(watcher.labels[0],  px, ty);
					ty += fontsize;
					ctx.fillText(watcher.labels[1], px, ty);
					ty += fontsize;
					ctx.fillText(watcher.labels[2], px, ty);

					
				}
			}
		}
		// ctx.fillStyle = "white";
		// ctx.drawImage(gl.canvas, 
		// 	0, 0, gl.canvas.width, gl.canvas.height,
		// 	0, 0, canvas.width, canvas.height);

		//console.log("tick")
	}
	
	update();

	
}

const sock = new Socket({
	reload_on_disconnect: true,
});
sock.onmessage = function(msg) {
	if (msg.cmd == "watchers") {
		grid = msg.grid
	} else if (msg.cmd == "video") {
		console.log("reload video", msg.url)
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


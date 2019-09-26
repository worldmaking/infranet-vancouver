
// don't run script until everything is loaded:
window.addEventListener('load', init);

//console.log(shared)


const { vec2, vec3, vec4, quat, mat3, mat4 } = glMatrix;


// true globals:
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;
const world = shared.world; 
world.t0 = performance.now();
world.t = 0;

let camera_height = 500;

let newdata = null;

let debugLevel = 4;
let sharpness = 0.8;
let gamma = 2.27;
let composite_mix = [1, 1, 0.25];
let inputfbo_subdiv = 1
let trailfbo_subdiv = 2
let syncfbo_subdiv = 2
let heightMapMax = 200.;

let fps = new utils.FPS()

const canvas = document.getElementById("canvas");
let mouse = {
	x: 0.5, y: 0.5,
	down: false,
	everdown: false,
}
window.addEventListener("mousedown", function(evt) { mouse.down = true; mouse.everdown = true; }, true)
window.addEventListener("mouseup", function(evt) { mouse.down = false; }, true)
window.addEventListener("mouseleave", function(evt) { mouse.down = false; }, true)
canvas.addEventListener("mousemove", function(evt) {
	//console.log(e);
	const rect = canvas.getBoundingClientRect();
	mouse.x = (evt.clientX - rect.left) / (rect.right - rect.left)
	mouse.y = (evt.clientY - rect.top) / (rect.bottom - rect.top)
	//console.log(mouse);
});
let saveCanvas = 0
let topView = 1
window.addEventListener("keydown", function(e) {
	console.log("keycode", e.keyCode);

	if (e.keyCode == 70) { // F
		screenfull.toggle()
	} else if (e.keyCode == 83) { // S
		saveCanvas = 0;
	} else if (e.keyCode == 84) { // T
		topView = !topView;
	}
}, true);



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

	console.log("render dim", canvas.width, canvas.height)
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

world.streetsTex = glutils.createTexture(gl, {
	float: true,
	channels: 4, 
	width: world.size[0], 
	height: world.size[1],
	filter: gl.LINEAR,
})

let shader_shared_code = `
float getLuma(vec3 color) {
	const vec3 coeff = vec3(0.299,0.587,0.114);
	return dot(color, coeff);
}

vec3 vibrance(vec3 color, float amount) {
	const vec3 coeff = vec3(0.299,0.587,0.114);
	float lum = dot(color, coeff);
	vec3 mask = clamp((color - vec3(lum)), 0.0, 1.0);
    float lumMask = dot(coeff, mask);
    lumMask = 1.0 - lumMask;
    return mix(vec3(lum), color, 1.0 + amount * lumMask);
}

////////////////

float getHeight(sampler2D tex, vec2 texcoord, float heightFactor) {
	vec4 t1 = texture(tex, texcoord);
	float luma = getLuma(t1.rgb); 
	return pow(luma, 1./32.) * heightFactor;
}

`

let inputfbo = glutils.createFBO(gl, world.size[0]/inputfbo_subdiv, world.size[1]/inputfbo_subdiv, true, true);

let pointsProgram = glutils.makeProgram(gl, `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform float u_pointsize;
uniform vec3 u_camera_position;
uniform sampler2D u_heightmap;
uniform vec2 u_worldsize;
uniform float u_heightfactor;
in vec4 a_position;
in vec4 a_color;
out vec4 color;
${shader_shared_code}
void main() {
	vec4 pos = a_position.xzyw;
	pos.y += getHeight(u_heightmap, pos.xz / u_worldsize, u_heightfactor);
	
	vec4 viewpos = u_view * pos;
	float camDist = length(viewpos.xyz);
	gl_Position = u_projection * viewpos;
	gl_PointSize = u_pointsize * 3.*2000./camDist;
	color = a_color;
}`,
`#version 300 es
precision highp float;
in vec4 color;
out vec4 outColor;
${shader_shared_code}
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

let linesProgram = glutils.makeProgram(gl, 
`#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform vec3 u_camera_position;
uniform sampler2D u_heightmap;
uniform vec2 u_worldsize;
uniform float u_heightfactor;
in vec4 a_position;
in vec4 a_color;
out vec4 color;
${shader_shared_code}
void main() {
	vec4 pos = a_position.xzyw;
	pos.y += getHeight(u_heightmap, pos.xz / u_worldsize, u_heightfactor);
	
	vec4 viewpos = u_view * pos;
	float camDist = length(viewpos.xyz);
	gl_Position = u_projection * viewpos;
	color = a_color;
}
`, 
`#version 300 es
precision mediump float;
in vec4 color;
out vec4 outColor;
${shader_shared_code}
void main() {
	outColor = color;
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
${shader_shared_code}
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
${shader_shared_code}
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


let trailfbo = glutils.createFBO(gl, world.size[0]/trailfbo_subdiv, world.size[1]/trailfbo_subdiv, true, true);
let slab_trail = glutils.createSlab(gl, `#version 300 es
precision highp float;
uniform sampler2D u_tex0; // feedback
uniform sampler2D u_tex1; // new data from fbo
//uniform sampler2D u_tex4; // world data
uniform float u_fade;
in vec2 v_texCoord;
out vec4 outColor;
${shader_shared_code}
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
	"u_tex0": 0,
	"u_tex1": 1,
	u_tex4: 4,
	"u_fade": 0.99,
});

let syncfbo = glutils.createFBO(gl, world.size[0]/syncfbo_subdiv, world.size[1]/syncfbo_subdiv, true, true);
let slab_sync = glutils.createSlab(gl, `#version 300 es
precision highp float;
uniform sampler2D u_tex0; // feedback
uniform sampler2D u_tex1; // new input
//uniform sampler2D u_tex4;
uniform float u_fade;
uniform vec2 u_resolution;
in vec2 v_texCoord;
out vec4 outColor;

${shader_shared_code}
vec4 blur(sampler2D img, vec2 uv) {
	float r = 1.;
	vec2 s = vec2(r/u_resolution.x, r/u_resolution.y);
	vec4 p = vec4(s.x, s.y, -s.x, -s.y);
	float a = 0.25;
	float b = 0.5;
	return (
		texture(img, uv+(p.xy))
		+ texture(img, uv+(p.zw))
		+ texture(img, uv+(p.zy))
		+ texture(img, uv+(p.xw))
		+ texture(img, uv)
	) * 0.2;
}

void main() {
	// vec4 data = texture(u_tex4, v_texCoord);
	// float block = (1. - data.r);
	// float fade =  mix(u_fade, 0.995, clamp((data.b+data.g)*3.-0.5, 0., 1.));
	float fade = 0.99;// u_fade;

	vec4 tex1 = texture(u_tex1, v_texCoord);
	outColor.rgb = blur(u_tex0, v_texCoord).rgb * fade;

	//outColor.rgb = max(outColor.rgb, tex1.rgb / tex1.a);
	outColor.rgb += tex1.rgb * 0.9;

	// TODO re-enable
	// // block by buildings:
	// vec3 blocked = min(outColor.rgb, block);
	// outColor.rgb = mix(outColor.rgb, blocked, 0.25);

	outColor.a = 1.;

}
`,{
	"u_tex0": 0,
	"u_tex1": 1,
	u_tex4: 4,
	"u_fade": 0.995,
	"u_resolution": world.size,
});

let compositeProgram = glutils.makeProgram(gl, `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform sampler2D u_input;
uniform sampler2D u_heightmap;
uniform vec2 u_worldsize;
uniform float u_heightfactor;
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
out vec2 v_position;
${shader_shared_code}
void main() {
	v_texCoord = a_texCoord;
	vec4 pos = vec4(a_texCoord.x * u_worldsize.x, 0., a_texCoord.y * u_worldsize.y, 1.);
	pos.y += getHeight(u_heightmap, v_texCoord, u_heightfactor);

	gl_Position = u_projection * u_view * pos;
	v_position = a_position.xy;
	
}`,
`#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform sampler2D u_sync;
uniform float u_brightness;
in vec2 v_texCoord;
in vec2 v_position;
out vec4 outColor;
${shader_shared_code}
void main() {
	vec4 t0 = texture(u_input, v_texCoord);
	vec4 t1 = texture(u_sync, v_texCoord);
	
	outColor = t0 + t1;

	//outColor.rgb = vibrance(outColor.rgb, 2.);

	//outColor += vec4(0.5) + vec4(v_texCoord, 0., 0.);
}`)
let compositeMul = 4
let compositeVao = glutils.createVao(gl, glutils.makeQuadWithDivisions(compositeMul*1024, compositeMul*512), compositeProgram.id);
//let compositeVao = glutils.createVao(gl, glutils.makeQuad(4), compositeProgram.id);


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

		fps.tick()
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
		// if (1) {
		// 	const near = 1;
		// 	const far = world.size[1];

		// 	const zm = 0.5+ 0.25*(Math.cos(world.t / 11))

		// 	mat4.perspective(projection, 
		// 		zm, 
		// 		canvas.width/canvas.height,
		// 		near, far);
			
		// 	const centre = [world.size[0]/2, 0, world.size[1]/2]
		// 	const eyepos = [centre[0], centre[1]+far, centre[2]];
		// 	const up = [0, 0, -1];
		// 	mat4.lookAt(view, eyepos, centre, up);
		// }
		if (!topView) {

			const zm = 1. + 0.5*(Math.cos(world.t / 31))

			const near = 1;
			const far = world.size[0];
			
			let aspect = page_ratio; ///world_ratio
			mat4.perspective(projection, 
				Math.PI/3, 
				aspect, //canvas.width/canvas.height,
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
			
			if (!mouse.everdown) {
				camera_height = far/32 * (1.1 + Math.sin(world.t * .2));
			} else if (mouse.down) {
				camera_height = far/2 * mouse.y * mouse.y;
			}
			//h = far/4;

			vec3.set(camera_position, 
				centrex + d*x, 
				camera_height + heightMapMax,
				centrey + d*z
			);
			const up = [-x, 0, -z];
			mat4.lookAt(view, camera_position, centre, up);
		} else {
			const centre = [world.size[0]/2, 0, world.size[1]/2]
			let aspect = page_ratio / world_ratio
			let far = world.size[1];
			mat4.ortho(projection, 
				-centre[0] * aspect, 
				+centre[0] * aspect, 
				-centre[2], 
				+centre[2], 
				0, far);
			
			const eyepos = [centre[0], centre[1]+far-1, centre[2]];
			const up = [0, 0, -1];
			mat4.lookAt(view, eyepos, centre, up);
		}

		// capture new particles & lines
		inputfbo.begin().clear();
		{
			
			syncfbo.front.bind(1);
			gl.enable(gl.BLEND);
			gl.disable(gl.DEPTH_TEST);
			//gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			//gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			gl.depthMask(false);


			pointsProgram.begin()
				.uniform("u_projection", projection_fbo)
				.uniform("u_view", view_fbo)
				.uniform("u_camera_position", camera_position_fbo)
				.uniform("u_pointsize", 8/debugLevel)
				.uniform("u_heightmap", 1)
				.uniform("u_worldsize", world.size)
				.uniform("u_heightfactor", 0.)
			pointsVao.bind();
			gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
			pointsVao.unbind();
			pointsProgram.end();

			// linesProgram.begin()
			// 	.uniform("u_projection", projection_fbo)
			// 	.uniform("u_view", view_fbo)
			// 	.uniform("u_camera_position", camera_position_fbo)
			// 	.uniform("u_heightmap", 1)
			// 	.uniform("u_worldsize", world.size)
			// 	.uniform("u_heightfactor", 0.)
			// linesVao.bind().drawLines().unbind();
			// linesProgram.end();

			gl.enable(gl.DEPTH_TEST);
			gl.depthMask(true);
			gl.disable(gl.BLEND);
		}
		inputfbo.end();

		// now run the slab sequence:

		//feed into trails:
		trailfbo.begin().clear();
		{
			trailfbo.front.bind(0);
			inputfbo.front.bind(1);
			slab_trail.use();
			slab_trail.uniform("u_fade", 0.97);
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
		 	slab_sync.uniform("u_fade", 0.997);
			slab_sync.draw();
		}
		syncfbo.end(); 


		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// works with depth testing only:
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		
		gl.enable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		//gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		//gl.blendFunc(gl.ONE, gl.ONE);
		gl.depthMask(false);
		
		inputfbo.front.bind(0);
		//trailfbo.front.bind(1);
		syncfbo.front.bind(1);
		compositeProgram.begin()
		 	.uniform("u_projection", projection)
		 	.uniform("u_view", view)
			.uniform("u_input", 0)
			.uniform("u_heightmap", 1)
			.uniform("u_sync", 1)
			.uniform("u_worldsize", world.size)
			.uniform("u_heightfactor", heightMapMax)
		
		gl.cullFace(gl.FRONT); // quad seems to have the face winding backwards :-()
		//gl.cullFace(gl.BACK)
		gl.enable(gl.CULL_FACE);
		compositeVao.bind()
			.draw()
			//.drawLines()
		
		gl.disable(gl.CULL_FACE);
		compositeVao.unbind()
		compositeProgram.end()

		// quadVao.bind()
		// quadProgram.begin()
		// 	.uniform("u_projection", projection)
		// 	.uniform("u_view", view)
		// 	.uniform("u_tex0", 0)
		// 	.uniform("u_brightness", 0.4)
		// world.streetsTex.bind()
		// //quadVao.draw();

		// quadProgram.uniform("u_brightness", 1)
		// // inputfbo.front.bind(0)
		// // quadVao.draw()
		// trailfbo.front.bind(0)
		// //quadVao.draw()
		// //quadProgram.uniform("u_brightness", 0.5)
		// syncfbo.front.bind(0)
		// quadVao.draw()
		// quadVao.unbind();

		linesProgram.begin()
			.uniform("u_projection", projection)
			.uniform("u_view", view)
			.uniform("u_camera_position", camera_position)
			.uniform("u_heightmap", 1)
			.uniform("u_worldsize", world.size)
			.uniform("u_heightfactor", heightMapMax-2)
		linesVao.bind().drawLines().unbind();
		linesProgram.end()
		
		pointsProgram.begin()
			.uniform("u_projection", projection)
			.uniform("u_view", view)
			.uniform("u_camera_position", camera_position)
			.uniform("u_pointsize", 1)
			.uniform("u_heightmap", 1)
			.uniform("u_worldsize", world.size)
			.uniform("u_heightfactor", heightMapMax-2)
		pointsVao.bind();
		gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
		pointsVao.unbind();
		pointsProgram.end()
		
		/*
		"u_agents": 0,
	"u_sync": 1,
	"u_trails": 2,
	"u_areas": 3,
	u_data: 4,
	*/
		// slab_composite.use();
		// world.streetsTex.bind.bind(0);
		// slab_composite.draw();


		gl.enable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.depthMask(true);

		if (topView) {

			// trigger every 500ms:
			if (fps.t % 0.5 < fps.dt) {

				// works but slow
				if (sock.socket && sock.socket.readyState === WebSocket.OPEN) {
					
					console.log("saving image", saveCanvas)
					
					sock.send({ 
						cmd:"capture", 
						id: saveCanvas.toString().padStart(2, "0"),
						img:canvas.toDataURL({ format:'png', multiplier:4 }) 
					})
					
					// so slow it crashed the browser
					// syncfbo.bind().readPixels().unbind();
					// if (sock.socket && sock.socket.readyState === WebSocket.OPEN) {
					// 	console.log(syncfbo.front.data.buffer.byteLength)
					// 	sock.socket.send(syncfbo.front.data.buffer)
						
					// }
					
					saveCanvas++;

					if (saveCanvas >= shared.IMAGES_PER_VIDEO) {
						saveCanvas = 0;
						topView = false;
					}
				}
			}  else {
				// trigger every 500ms:
				if (fps.t % 60 < fps.dt) {
					topView = true;
				}
			}
		}

		//console.log("tick")
		requestAnimationFrame(update);
	}


	// let path = "/testData.png"
	// let oReq = new XMLHttpRequest();
	// oReq.responseType = "arraybuffer";
	// oReq.open("GET", path, true);
	// oReq.onload = function (ev) {
	// 	if (oReq.response) {
	// 		world.streetsTex.data = new Float32Array(oReq.response);
	// 		console.log("received", path); 
			
	// 		world.streetsTex.bind().submit();

	// 		// could we wait on images before doing this?
	// 		// or isn't there a way I can load the images locally?
			
	// 	}
	// };
	// oReq.send(null);
	// console.log('sending request', path)
	
	update();
	
}

const sock = new Socket({
	reload_on_disconnect: true,
});
sock.onmessage = function(msg) {
	console.log("got message", msg);
}
sock.onbuffer = function(data, byteLength) {
	//console.log("got buffer", byteLength, data);
	// copy data (arraybuffer) into shared:
	shared.dirty = true;

	newdata = data;
}


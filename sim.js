const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const performance = require('perf_hooks').performance;

const PNG = require('pngjs').PNG;
const { vec2, vec3, vec4, quat, mat3, mat4 } = require("gl-matrix");
const mmapfile = require('mmapfile');

const server_path = __dirname;
const client_path = path.join(server_path, "client");
const shared = require(path.join(client_path, "shared.js"))
const SpaceHash = require(path.join(client_path, "libs", "spacehash.js"))
const utils = require(path.join(client_path, "libs", "utils.js"))
const neataptic = require(path.join(client_path, "libs", "neataptic.js"))
const neato = require(path.join(client_path, "libs", "neato.js"))

const world = shared.world;
const NUM_AGENTS = shared.NUM_AGENTS;
const MAX_LINE_POINTS = shared.MAX_LINE_POINTS;
const MAX_NEIGHBOURS = 4;
const agent_reward_decay = 0.95;
const agent_reward_minimum = 0.1;
const agent_search_radius = 25;
const agent_scent_deviation = 0.5; //2;
const agent_entrainment = 0.5;
const agent_scent_adoption_rate = 0.1;
const agent_nnscent_rate = 0.5;
const agent_copy_chance = 0.1;
const agent_base_speed = 3;
const agent_base_rate = 1/2;
let audioLoopSeconds = 2;
let audioChannels = 8;
const floatBytes = 4;
const shortBytes = 2;

const halfvec3 = vec3.fromValues(0.5, 0.5, 0.5);

// open a file for read/write & map to a Buffer
let buf = mmapfile.openSync("audio/audiostate.bin", audioChannels*NUM_AGENTS*floatBytes, "r+");	
let audiostate = new Float32Array(buf.buffer);
console.log("audiostate.byteLength", audiostate.byteLength); // 8

function pick(arr) {
	return arr[Math.floor(Math.random()*arr.length)];
}

function createField2D(opt) {
	const channels = opt.channels || 4; // RGBA
	const width = opt.width || 16;
	const height = opt.height || 16;
	let self = {
		width: width,
		height: height,
		channels: channels,
		data: null,

		allocate() {
			this.data = new Float32Array(this.width * this.height * this.channels);
			return this;
		},

		// no bounds checking here
		index(pos) {
			let x = Math.floor(pos[0]);
			let y = Math.floor(pos[1]);
			let idx = (y*this.width + x) * this.channels;
		},

		index_clamped(pos) {
			let x = Math.max(0, Math.min(this.width-1, Math.floor(pos[0])));
			let y = Math.max(0, Math.min(this.height-1, Math.floor(pos[1])));
			return (y*this.width + x)*this.channels;
		},

		view(index) {
			return new Float32Array(this.data.buffer, index*4, 4);
		},

		viewDot4(idx, v) {
			return  v[0]*this.data[idx+0] +
					v[1]*this.data[idx+1] +
					v[2]*this.data[idx+2] +
					v[3]*this.data[idx+3];

					
		// let val1 = sim.streets.data[idx1+0]*prefs[0] + 
		// sim.streets.data[idx1+1]*prefs[1] + 
		// sim.streets.data[idx1+2]*prefs[2] + 
		// sim.streets.data[idx1+3]*prefs[3];


		},
		

		// TODO read / readInto methods for accessing underlying data

		read(pos) {
			let x = Math.floor(pos[0]);
			let y = Math.floor(pos[1]);
			let idx = (y*this.width + x) * this.channels; // TODO: assumes single-channel
			return this.data[idx];
		}
	}
	return self;
}

function readImageData(pngpath, floatarray) {
	fs.createReadStream(path.join("data", pngpath))
	.pipe(new PNG({
		filterType: 4
	}))
	.on('parsed', function() {
		let i=0;
		//console.log(this)
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				let idx = (this.width * y + x) << 2;
				// RGBA
				floatarray[i++] = this.data[idx++]/255; 
				floatarray[i++] = this.data[idx++]/255; 
				floatarray[i++] = this.data[idx++]/255; 
				floatarray[i++] = this.data[idx++]/255; 
			}
		}
		console.log("read", pngpath, this.width, this.height);
		// let buf = Buffer.from(allStreets.buffer)
		// console.log("sending back", buf);

		// sim.streets.data = a
	});
}

class Watcher {
	constructor(i, grid, sim) {
		this.id = i;
		this.col = i % grid.cols;
		this.row = Math.floor(i / grid.cols);
		this.agent = Math.floor(Math.random()*sim.agents.length);
		this.zoom = Math.random();
		this.reward = Math.random();
		this.difference = Math.random();
		this.pos = [0, 0];
		this.agentpos = [0, 0];
		this.labels = [];
	}

	update(sim, fps) {
		this.zoom -= fps.dt * 0.01;

		// switch attention
		if (this.zoom <= 0.04) {
			this.agent = Math.floor(Math.random()*sim.agents.length);
			this.zoom = 1;
		} else {
			let self = sim.agents[this.agent];
			let near = self.near;
			if (near.length > 0) {
				let n = near[Math.floor(Math.random()*near.length)];
				// CHOOSE A MORE INTERESTING NEIGHBOUR TO FOLLOW?
				let difference = vec3.angle(self.scent, n.scent);

				// difference as a measure of discovery
				this.difference = difference;

				if (Math.random() < (this.zoom * difference * (n.active - self.active))) {
					this.agent = n.id;
				}
			}
		}

		let a = sim.agents[this.agent];
		vec2.copy(this.agentpos, a.pos);
		vec2.lerp(this.pos, a.pos, this.pos, 1-0.1*(1-this.zoom));
		
		this.reward = a.reward;

		let kmx = (this.pos[0]*sim.tokm);
		let kmy = (this.pos[1]*sim.tokm);
		let nx = Math.floor(100*this.pos[0]/sim.world.size[0]);
		let ny = Math.floor(100*this.pos[1]/sim.world.size[1]);
		let zz = ((this.zoom * 127.5) * sim.meters_per_pixel); 

		this.labels[0] = a.birthdata;
		this.labels[1] = `${kmx.toFixed(1)},${kmy.toFixed(1)}km (${nx},${ny})`
		this.labels[2] = `${a.reward.toFixed(3)} ${this.difference.toFixed(3)} ±${Math.floor(zz)}m`;
	}
};

const sim = {
	shared: shared,
	world: shared.world,
	fps: new utils.FPS(),
	space: new SpaceHash({
		width: world.size[0],
		height: world.size[1],
		cellSize: 20 // why 20?
	}),

	streets: createField2D({
		width: world.size[0], 
		height: world.size[1],
		channels: 4,
	}).allocate(),

	
	linePointsPerFrame: 0,
	lines: [],
	agents: [],

	watchers: [],

	init() {

		readImageData('/testData.png', sim.streets.data)

		for (let i=0; i<NUM_AGENTS; i++) {
			let a = {
				id: i,

				// orientation:
				pos: [0, 0],
				fwd: [1, 0],
				side: [0, -1],
				dir: 0,
				
				// pulsations:
				phase: Math.random(),
				rate: agent_base_rate, // base rate of pulse
				dphase: 0, // accelaration/deceleration of pulse
		
				// perception
				reward: 1,
				near: [],

				// preference:
				scent: [0.5, 0.5, 0.5],

				// parameters:
				speed: agent_base_speed, // base speed of motion
				speedpower: 3, // 1 means continuous, 4 is very pronounced 
				network: null,
			}
			sim.space.insertPoint(a);
			sim.agents[i] = sim.agent_reset(a);
		
			a.near = [];
		}

		sim.grid = {
			cols: 11, 
			rows: 5,

			watchers: sim.watchers,
		};
		
		sim.grid.cellcount = sim.grid.cols * sim.grid.rows;

		for (let i=0; i<sim.grid.cellcount; i++) {
			sim.watchers[i] = new Watcher(i, sim.grid, sim); 
		}
	},

	agent_reset(a) {	
		a.pos[0] = Math.random() * world.size[0];
		a.pos[1] = Math.random() * world.size[1];
		vec2.random(a.fwd, 1.);
		a.dir = Math.atan2(a.fwd[1], a.fwd[0]);
		vec2.set(a.side, a.fwd[1], -a.fwd[0]);
		
		a.speed = agent_base_speed;
		a.speed = agent_base_speed * 0.75 * (0.1 + 4. * Math.pow(Math.random(), 2));


		a.phase = Math.random();
		a.rate = agent_base_rate;
		a.dphase = 0;

		a.reward = Math.random();
		a.near = [];
		//vec3.set(a.scent, 0.5, 0.5, 0.5 );
		vec3.add(a.scent, vec3.random(a.scent, 0.5), halfvec3);

		a.network = neato.createNetwork();
		neato.mutateOnce(a.network);

		// TODO: generate name:
		/*
			let name = ""
            world.areas.readInto(this.pos[0], this.pos[1], color);
            if (color[1] > 0.1) name += "N";
            if (color[0] > 0.1) name += "B";
            if (color[2] > 0.1) name += "I";
            world.data.readInto(this.pos[0], this.pos[1], color);
            if (color[1] > 0.1) name += "M";
            world.ways.readInto(this.pos[0], this.pos[1], color);
            if (color[1] > 0.1) name += "W";
            if (name.length == 0) name = "Z";

            let d = new Date();
            this.meta.birthdata = `${(d.getMonth()+1)}${(d.getDate().toString().padStart(2, '0'))}_${(d.getHours()).toString().padStart(2, '0')}:${(d.getMinutes()).toString().padStart(2, '0')}_${name}`;
		*/
		a.birthdata = `agent${a.id}`
	
		return a;
	},

	agent_move(a, dt) {

		// recycle:
		// (TODO should be based on reward also)
		if (a.reward < agent_reward_minimum) {
			// reset:
			this.agent_reset(a);
		}
		/*
			// RECYCLE IF IN DEAD ZONE:
			let color = [0, 0, 0, 0];
            world.ways.readInto(s1[0], s1[1], color);

            if (Math.random() >= color[3]) {
                this.reset(world);
                return;
            }
		*/

		// // update activation phase:
		a.phase -= (dt*a.rate + a.dphase);
		if (a.phase < 0) {
		 	a.phase += 1;
		} else if (a.phase >= 1) {
			a.phase -= 1;
		}

		a.dir = Math.atan2(a.fwd[1], a.fwd[0]);
		vec2.set(a.side, a.fwd[1], -a.fwd[0]);
		let speed = Math.pow(a.phase, a.speedpower);
		a.pos[0] += (a.speed * speed) * a.fwd[0];
		a.pos[1] += (a.speed * speed) * a.fwd[1];

		// wrap in world:
		if (a.pos[0] > world.size[0]) {
			a.pos[0] -= world.size[0];
		} else if (a.pos[0] < 0) {
			a.pos[0] += world.size[0];
		}
		if (a.pos[1] > world.size[1]) {
			a.pos[1] -= world.size[1];
		} else if (a.pos[1] < 0) {
			a.pos[1] += world.size[1];
		}

		// just in case:
		if (isNaN(a.pos[0]) || isNaN(a.pos[1])) {
			agent_reset(a);
		}
	},


	agent_update(a, dt) {

		sim.space.searchUnique(a, agent_search_radius, MAX_NEIGHBOURS, a.near);

	
		// check local data:
		let eye1 = [
			a.pos[0] + a.fwd[0] + a.side[0], 
			a.pos[1] + a.fwd[1] + a.side[1]];
		let eye2 = [
			a.pos[0] + a.fwd[0] - a.side[0], 
			a.pos[1] + a.fwd[1] - a.side[1]];

		let idx0 = sim.streets.index_clamped(a.pos)
		let idx1 = sim.streets.index_clamped(eye1)
		let idx2 = sim.streets.index_clamped(eye2)

		let cell0 = sim.streets.view(idx0);

		let cell1 = sim.streets.view(idx1);
		let cell2 = sim.streets.view(idx2);
		// let val1 = cell1[0]; //Math.random()
		// let val2 = cell2[0]; //Math.random()

		let prefs = [1, 0, 0, 0];
		let val1 = sim.streets.viewDot4(idx1, prefs);
		let val2 = sim.streets.viewDot4(idx2, prefs);

		// let val1 = world.streetsTex.read(eye1);
		// let val2 = world.streetsTex.read(eye2);

	
		let avg = (val2+val1)*0.5;
		let diff = (val2-val1)*0.5;


		//a.dphase += (avg*avg) * 0.5;

		let inputs = cell0; //[avg, diff]
		let outputs = a.network.activate(inputs);
		//a.scent = outputs;
		vec3.lerp(a.scent, a.scent, outputs, agent_nnscent_rate);
		// could set speed to ouutputs[3] for eaxmple?
		a.speed = agent_base_speed * (0.5 + 0.4*(outputs[3]))

		//if (a.id == 0) console.log(a.scent)
		
		// // deviate scent:
		// let dev = vec3.random(vec3.create(), dt*agent_scent_deviation)
		// vec3.add(a.scent, a.scent, dev);
		// a.scent[0] = (a.scent[0] > 1) ? 1 : (a.scent[0] < 0) ? 0 : a.scent[0];
		// a.scent[1] = (a.scent[1] > 1) ? 1 : (a.scent[1] < 0) ? 0 : a.scent[1];
		// a.scent[2] = (a.scent[2] > 1) ? 1 : (a.scent[2] < 0) ? 0 : a.scent[2];
		
		
		if (Math.random() < avg) {
			a.reward = 1;
		} else {
			a.reward *= agent_reward_decay;
		}
	
		let turn = diff;
		// TODO: how much randomness here?
		turn *= (1. + 0.5*Math.random());
		if (Math.abs(turn) < 0.01) { // gwangju
			turn = 0.25*(Math.random()-0.5);
		}
		// if (avg < 0.1) { // nyc
		// 	turn = Math.random() - 0.5;
		// }

		// now update movement:
		a.dir += (turn); 
		if (Number.isNaN(a.dir)) console.log("Nan", a);
		vec2.set(a.fwd, Math.cos(a.dir), Math.sin(a.dir));
		vec2.normalize(a.fwd, a.fwd);
	
		
		
		// TODO: phase entrainment

		/*
		 	concept: want to align phase with neighbours

                    on every frame, decrement activation by a small amount (constant for all, or per agent, or 'adapted'?)
                    when activation reaches zero, fire back up to 1

                    when active > 0.5, don't listen to neighbours

                    when active < 0.5, compare with neighbors
                    ignore neighbours whose activation phases are far from ours
						but if similar, adjust ours toward the average
		*/
		if (a.near.length > 1) {
			let aavg = 0;
			for (let n of a.near) {
				
				// 	// TODO!!! 
				if (Math.random() < agent_copy_chance*(n.reward - a.reward)) {
					//if (a.id==0) console.log("--------------------------- copy & mutate", a.id, n.id)
					
					// copy the network:
					a.network = neato.copyNetwork(n.network)
					if (Math.random() < 0.01) neato.mutateOnce(a.network);
					this.reward = n.reward;
				}

				// get activation difference:
				let ad = n.phase - a.phase;
				let totalphase = n.phase + a.phase;
				// wrapped into +/- 0.5;
				let sad = (ad - Math.floor(ad + 0.5)); 

				// listening threshold:
				if (n.phase > 0.5) {
					// accumulate differences:
					aavg += sad;
				}

				// only listen to louder voices:
				if (ad > 0) {
					vec3.lerp(a.scent, a.scent, n.scent, agent_scent_adoption_rate);
				}

				// condition of rendering a line:
				//if (n.phase > 0.5) { // draw when listening
				//if (ad > 0) { // draw when transferring scent
				if (n.id > a.id) { // ensure we don't double-up lnies
					this.lines[this.linePointsPerFrame++] = n.id;
					this.lines[this.linePointsPerFrame++] = a.id;
				}
			}
			aavg /= a.near.length;
			a.dphase = -agent_entrainment * (aavg);
			a.rate += 0.1 * a.dphase;

		} else {
			a.dphase = 0; //deviation*Math.random();
		}
			
		// parameter updates:
		//a.speed = agent_base_speed * 0.75 * (0.1 + 4. * a.scent[0]*a.scent[0]);

		//a.dphase -= 0.1*(a.scent[1]-0.5);

		return a;
	},


	animate(dt) {
		this.linePointsPerFrame = 0;

		for (let i=0; i<NUM_AGENTS; i++) {
			let a = sim.agents[i];
			sim.agent_move(a, dt);
			sim.space.updatePoint(a);
		}

		for (let i=0; i<NUM_AGENTS; i++) {
			sim.agent_update(sim.agents[i], dt);
		}

		for (let w of sim.watchers) {
			w.update(sim, sim.fps);
		}
		//if (world.t < 1) console.log(JSON.stringify(watchers[0]));

		// update buffers:
		// update buffers:
		for (let i=0; i<NUM_AGENTS; i++) {
			let a = this.agents[i];
			shared.agent_positions[i*2 + 0] = a.pos[0];
			shared.agent_positions[i*2 + 1] = a.pos[1];

			shared.agent_colors[i*4+0] = a.scent[0];
			shared.agent_colors[i*4+1] = a.scent[1];
			shared.agent_colors[i*4+2] = a.scent[2];
			shared.agent_colors[i*4+3] = a.phase;



			// for (let n of a.near) {
			// 	// we only need to count it one way:
			// 	if (n.id > a.id) continue;
			// 	if (this.linePointsPerFrame < MAX_LINE_POINTS) {
			// 		shared.line_indices[this.linePointsPerFrame++] = a.id;
			// 		shared.line_indices[this.linePointsPerFrame++] = n.id;
			// 	} else {
			// 		this.linePointsPerFrame += 2;
			// 	}
			// 	//
			// }
		}
		let numpts = Math.min(this.linePointsPerFrame, MAX_LINE_POINTS);
		for (let i=0; i<numpts; i++) {
			shared.line_indices[i] = this.lines[i];
		}
		shared.params[0] = numpts;

		
		for (let i=0; i<NUM_AGENTS; i++) {
			let a = this.agents[i];
			let sidx = a.id * audioChannels
			audiostate[sidx+0] = a.pos[0] / world.size[0];
			audiostate[sidx+1] = a.pos[1] / world.size[1];
			audiostate[sidx+2] = a.phase;
			audiostate[sidx+3] = a.reward;
			audiostate[sidx+4] = a.scent[0];
			audiostate[sidx+5] = a.scent[1];
			audiostate[sidx+6] = a.scent[2];
			audiostate[sidx+7] = a.rate;
		}
		
	},

	update() {
		sim.fps.tick();


		this.animate(this.fps.dt);

		if (sim.fps.t % 5 < sim.fps.dt) {
			console.log("fps: ", Math.floor(sim.fps.fpsavg))
			console.log("linePointsPerFrame:", this.linePointsPerFrame, MAX_LINE_POINTS)
			//refocus();
			//agents.sort((a, b) => b.reward - a.reward);
		}
	},
};


sim.init();

module.exports = sim;
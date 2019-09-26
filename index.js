const http = require('http');
const url = require('url');
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const performance = require('perf_hooks').performance;
const { spawn, exec } = require('child_process');
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const { vec2, vec3 } = require("gl-matrix");
const PNG = require('pngjs').PNG;

// const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
// console.log(ffmpegPath)
// const ffmpeg = require('fluent-ffmpeg');
// ffmpeg.setFfmpegPath(ffmpegPath);

const project_path = process.cwd();
const server_path = __dirname;
const client_path = path.join(server_path, "client");
const tmp_path = path.join(client_path, "tmp");
console.log("project_path", project_path);
console.log("server_path", server_path);
console.log("client_path", client_path);


// // make sure you set the correct path to your video file
// var proc = ffmpeg(path.join(tmp_path, "0.png"))

// for (let i=0; i<30; i++) {
// 	proc.input(path.join(tmp_path, i+".png"))
// }

// proc.noAudio()
// 	.videoCodec('libtheora')
// //	.size('320x240')
//   // loop for 5 seconds
//  // .loop(25)
//   // using 25 fps
//   .fps(25)
//   // setup event handlers
//   .on('end', function() {
//     console.log('VIDEO FILE CREATED!!');
//   })
//   .on('error', function(err) {
//     console.log('ffmpeg error happened: ' + err.message);
//   })
//   // save to file
//   //MP4, WebM, and Ogg
//   //.save(path.join(tmp_path, "vid.mp4"));
//   .save(path.join(tmp_path, "vid.ogg"));

const sim = require(path.join(server_path, "sim.js"))
const utils = require(path.join(client_path, "libs", "utils.js"))
const neataptic = require(path.join(client_path, "libs", "neataptic.js"));
const neato = require(path.join(client_path, "libs", "neato.js"));
////////////////////////



const app = express();
app.disable('view cache');
app.use(express.static(client_path, {
	maxage: '0h',
	etag: false
}))
app.set('trust proxy', true);
app.use(bodyParser.urlencoded({limit: '128mb', extended: true}));
app.use(bodyParser.json({limit: '16mb'}));

app.get('/', function(req, res) {
	res.sendFile(path.join(client_path, 'client.html'));
});

const pngpath = '/testData.png';
app.get(pngpath, function(req, res) {
	console.log("requested", pngpath)
	res.send(Buffer.from(sim.streets.data.buffer));
});


const server = http.createServer(app);
// add a websocket service to the http server:
const wss = new WebSocket.Server({ server });

// send a (string) message to all connected clients:
function send_all_clients(msg) {
	wss.clients.forEach(function each(client) {
		try {
			client.send(msg);
		} catch (e) {
			console.error(e);
		};
	});
}

// whenever a client connects to this websocket:
wss.on('connection', function(ws, req) {

    //console.log("ws", ws)
    //console.log("req", req)

	console.log("server received a connection");
	console.log("server has "+wss.clients.size+" connected clients");
	
	const location = url.parse(req.url, true);
	// You might use location.query.access_token to authenticate or share sessions
	// or req.headers.cookie (see http://stackoverflow.com/a/16395220/151312)
	ws.on('error', function (e) {
		if (e.message === "read ECONNRESET") {
			// ignore this, client will still emit close event
		} else {
			console.error("websocket error: ", e.message);
		}
	});

	// what to do if client disconnects?
	ws.on('close', function(connection) {
		console.log("connection closed");
        console.log("server has "+wss.clients.size+" connected clients");
	});
	
	// respond to any messages from the client:
	ws.on('message', function(e) {
		if (e instanceof Buffer) {
			// get an arraybuffer from the message:
			const ab = e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength);
			console.log("received arraybuffer", ab);
			// as float32s:
			//console.log(new Float32Array(ab));
		} else {
			try {
				handlemessage(JSON.parse(e), ws);
			} catch (e) {
				console.log('bad JSON: ', e);
			}
		}
    });
});

let video_id = 0;
let vidurl = `tmp/vid${video_id}.mp4`

function handlemessage(msg, session) {
	switch (msg.cmd) {
		case "capture": {
			// save to png:
			let dataUrl = msg.img;
			let imgID = msg.id;
			let data = dataUrl.split(",")[1]
			let buffer = Buffer.from(data, 'base64') // new Buffer(matches[2], 'base64');
			let savePath = path.join(tmp_path, "cap" + imgID + '.png');
			fs.writeFile(savePath, buffer,  function(err) {
				if(err) {
					return console.log(err);
				}
				console.log(savePath, "was saved!");
				
				// if (+imgID >= sim.shared.IMAGES_PER_VIDEO-1) {
				// 	console.log("converting images to video")
				// 	// ffmpeg.exe -f image2 -r 30 -i cap%02d.png test.mp4
				// 	let next_id = video_id+1
				// 	let next_vidurl = `tmp/vid${next_id}.mp4`

				// 	// To crop a 80×60 section, starting from position (200, 100):
				// 	//-vf "crop=80:60:200:100" -c:a copy out.mp4
				// 	// to crop bottom-right quarter:
				// 	//-vf "crop=in_w/2:in_h/2:in_w/2:in_h/2" -c:a copy out.mp4

				// 	exec(`"${ffmpegPath}" -y -f image2 -r 30 -i client/tmp/cap%02d.png -vf scale=960:600 client/${next_vidurl}`, (error, stdout, stderr) => {
				// 		if (error) {
				// 			console.error(`video conversion error: ${error}`);
				// 			return;
				// 		}
				// 		console.log(stdout, stderr)
				// 		console.log("VIDEO CREATION COMPLETE", next_vidurl)
				// 		// NOTIFY clients there is a new video:
				// 		send_all_clients(JSON.stringify({
				// 			cmd: "video",
				// 			url: next_vidurl
				// 		}));

				// 		// delete old video:
				// 		fs.unlink(path.join(client_path, vidurl), function(err) {
				// 			console.log("deleted old video")
				// 		});
				// 		vidurl = next_vidurl;
				// 		video_id = next_id;
				// 	});
				// }
			});
		} break;
		case "getwatchers": {
			try {
				session.send(JSON.stringify({cmd:"watchers", grid:sim.grid}))
			} catch (e) {
				console.error(e);
			}
		} break;
		case "getdata": {
			//console.log("sending to", session)
			//session.send(JSON.stringify({cmd: "thanks"}))
			session.send(allStreets)
		} break;
		case "reset": {
			process.exit(-1)
			break;
		}
		default: console.log("received JSON", msg, typeof msg);
	}
}

function update() {
	// update simulation
	sim.update();
	// send everything to the client(s)
	send_all_clients(sim.shared.buffer);
	// repeat
	setTimeout(update, 1000/60);
}

server.listen(8080, function() {
	console.log(`server listening`);
	console.log(`main view on http://localhost:${server.address().port}/index.html`);
	
	// start:
	update();
});
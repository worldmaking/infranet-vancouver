
(function() {
	const isCommonjs = typeof module !== 'undefined' && module.exports;


	const shared = {
		NUM_AGENTS: 8192,
		MAX_LINE_POINTS: 8192 * 2,	

		IMAGES_PER_VIDEO: 75,

		param_names: [
			"lineCount",
		],
		
		world: {
			size: [8192, 4096],
		},
	};
	
	let total_bytes = 0;

	shared.agent_positions_offset = total_bytes;
	shared.agent_positions_count = shared.NUM_AGENTS * 2;
	shared.agent_positions_bytes = shared.agent_positions_count * 4;
	total_bytes += shared.agent_positions_bytes;

	shared.agent_colors_offset = total_bytes;
	shared.agent_colors_count = shared.NUM_AGENTS * 4;
	shared.agent_colors_bytes = shared.agent_colors_count * 4; // sizeof(float)
	total_bytes += shared.agent_colors_bytes;

	shared.line_indices_offset = total_bytes;
	shared.line_indices_count = shared.MAX_LINE_POINTS;
	shared.line_indices_bytes = shared.line_indices_count * 2; // sizeof(uint16)
	total_bytes += shared.line_indices_bytes;

	// shared.trail_offset = total_bytes;
	// shared.trail_count = shared.world.size[0] * 100 * 4; //shared.world.size[0] * shared.world.size[1] * 4; // RGBA
	// shared.trail_bytes = shared.trail_count * 4; // sizeof(float)
	// total_bytes += shared.trail_bytes;

	shared.params_offset = total_bytes;
	shared.params_count = shared.param_names.length;
	shared.params_bytes = shared.params_count * 4;
	total_bytes += shared.params_bytes;
	

	shared.buffer = new ArrayBuffer(total_bytes);
	shared.agent_positions = new Float32Array(shared.buffer, shared.agent_positions_offset, shared.agent_positions_count);
	shared.agent_colors = new Float32Array(shared.buffer, shared.agent_colors_offset, shared.agent_colors_count);
	shared.line_indices = new Uint16Array(shared.buffer, shared.line_indices_offset, shared.line_indices_count);

	//shared.trail = new Float32Array(shared.buffer, shared.trail_offset, shared.trail_count);

	shared.params = new Float32Array(shared.buffer, shared.params_offset, shared.params_count);

	shared.total_bytes = total_bytes;

	console.log("shared bytes:", total_bytes)

	if (isCommonjs) {
		module.exports = shared;
	} else {
		window.shared = shared;
	}
})();